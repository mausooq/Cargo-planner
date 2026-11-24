import { CanvasTexture, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Material } from "three"
import { bodiesOverlap, validateDrop } from "@compass/physics"
import { boxFitsContour, type SolverEquipment } from "@compass/solver"
import { applyDropPosition, itemToPiece, unitToWorld } from "@/lib/cargo-physics"
import { faceCanvasSize, layoutLabel, type MeasureText } from "@/lib/cargo-label"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"
import { hasContourCuts, type UldContour } from "@/lib/uld-contour"

const EPS = 0.05

const LABEL_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
const labelFont = (size: number, bold: boolean) => `${bold ? 800 : 600} ${size}px ${LABEL_FONT}`

/**
 * One face of a box: the cargo colour with a white label plate in the middle. The label is sized
 * to fit the face (see layoutLabel), so long descriptions wrap and shrink instead of running off
 * the edge, and the drawing surface has the face's own shape, so text is never stretched.
 */
export function makeFaceTexture(input: {
  color: string
  label?: { mark: string | null; text: string }
  hatch?: boolean
  aspect: number
}): CanvasTexture | null {
  if (typeof document === "undefined") return null
  // Kept modest on purpose: big plans can show hundreds of faces at once, and each texture is
  // uploaded to the graphics card. Identical pieces share one (see the material cache below).
  const { width, height } = faceCanvasSize(input.aspect)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  ctx.fillStyle = input.color
  ctx.fillRect(0, 0, width, height)

  if (input.hatch) {
    // A light hatch marks the top of a piece without fighting the label.
    ctx.strokeStyle = "rgba(255,255,255,0.3)"
    ctx.lineWidth = 3
    const step = 18
    for (let x = -height; x < width + height; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + height, height)
      ctx.stroke()
    }
  }

  if (input.label?.text) {
    // On a tall narrow face the label runs up the long side, like a label on a book spine.
    const sideways = height > width * 1.5
    const across = sideways ? height : width
    const down = sideways ? width : height
    const measure: MeasureText = (text, size, bold) => {
      ctx.font = labelFont(size, bold)
      return ctx.measureText(text).width
    }
    const layout = layoutLabel({
      mark: input.label.mark,
      text: input.label.text,
      maxWidth: across * 0.8,
      maxHeight: down * 0.68,
      maxFontSize: Math.min(46, down * 0.26),
      minFontSize: 12,
      measure,
    })
    const padX = layout.fontSize * 0.55
    const padY = layout.fontSize * 0.4
    const plateWidth = Math.min(across * 0.94, layout.width + padX * 2)
    const plateHeight = Math.min(down * 0.92, layout.height + padY * 2)

    ctx.save()
    ctx.translate(width / 2, height / 2)
    if (sideways) ctx.rotate(-Math.PI / 2)
    ctx.beginPath()
    ctx.roundRect(-plateWidth / 2, -plateHeight / 2, plateWidth, plateHeight, Math.min(10, plateHeight / 4))
    ctx.fillStyle = "rgba(255,255,255,0.95)"
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = "rgba(17,24,39,0.35)"
    ctx.stroke()

    ctx.fillStyle = "#111827"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const firstLine = -layout.height / 2 + layout.lineHeight / 2
    for (const [index, line] of layout.lines.entries()) {
      ctx.font = labelFont(layout.fontSize, line.bold)
      ctx.fillText(line.text, 0, firstLine + index * layout.lineHeight)
    }
    ctx.restore()
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  // Keeps the label readable on faces seen at a slant.
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

export function cargoBoxMaterials(
  color: string,
  label: string,
  length: number,
  width: number,
  height: number,
  mark: string | null = null,
) {
  const ink = { mark: mark?.trim() || null, text: label.trim() || "Cargo" }
  const side = (aspect: number, hatch = false) => {
    const map = makeFaceTexture({ color, label: ink, hatch, aspect }) ?? undefined
    return new MeshBasicMaterial({ map, color: map ? "#ffffff" : color, toneMapped: false })
  }

  const top = side(length / Math.max(width, 0.01), true)
  const bottom = new MeshBasicMaterial({ color, toneMapped: false })
  const alongWidth = side(length / Math.max(height, 0.01))
  const alongLength = side(width / Math.max(height, 0.01))
  return [alongLength, alongLength, top, bottom, alongWidth, alongWidth]
}

export function cargoSolidMaterial(color: string) {
  return new MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.06, toneMapped: false })
}

export function cargoRoundMaterials(color: string) {
  return [new MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.06, toneMapped: false })]
}

export function disposeMaterials(materials: Material[]) {
  const seen = new Set<Material>()
  for (const material of materials) {
    if (seen.has(material)) continue
    seen.add(material)
    if ("map" in material && material.map && typeof material.map === "object" && "dispose" in material.map && typeof material.map.dispose === "function") {
      material.map.dispose()
    }
    material.dispose()
  }
}

/*
 * Shared material cache.
 * Identical pieces (same cargo line, colour and size) reuse one set of materials and label
 * textures instead of each drawing its own. A plan with 100 copies of a box used to create
 * 300 canvases per 3D view; now it creates 3. Entries are reference counted: a component
 * reads with getCargoMaterials() during render, holds with retainCargoMaterials() in an
 * effect, and the entry is freed shortly after the last holder lets go.
 */
type CacheEntry = { materials: Material[]; refs: number; disposeTimer: ReturnType<typeof setTimeout> | null }
const materialCache = new Map<string, CacheEntry>()

export type CargoMaterialSpec = {
  color: string
  label: string
  /** The piece's mark (SKU), printed on its own line above the label when given. */
  mark?: string | null
  length: number
  width: number
  height: number
  round: boolean
  /** Small views (thumbnails, Top/Right/Front): flat colour, no label texture. */
  simple: boolean
}

export function cargoMaterialKey(spec: CargoMaterialSpec): string {
  const size = (value: number) => Math.round(value * 20) / 20
  if (spec.round) return `round|${spec.color}`
  if (spec.simple) return `flat|${spec.color}`
  return ["box", spec.color, spec.mark?.trim() ?? "", spec.label.trim(), size(spec.length), size(spec.width), size(spec.height)].join("|")
}

export function getCargoMaterials(spec: CargoMaterialSpec): { key: string; materials: Material[] } {
  const key = cargoMaterialKey(spec)
  let entry = materialCache.get(key)
  if (!entry) {
    const materials = spec.round
      ? cargoRoundMaterials(spec.color)
      : spec.simple
        ? Array.from({ length: 6 }, () => flatFace(spec.color))
        : cargoBoxMaterials(spec.color, spec.label, spec.length, spec.width, spec.height, spec.mark ?? null)
    entry = { materials, refs: 0, disposeTimer: null }
    materialCache.set(key, entry)
  }
  return { key, materials: entry.materials }
}

let flatCache = new Map<string, MeshBasicMaterial>()
function flatFace(color: string): MeshBasicMaterial {
  let material = flatCache.get(color)
  if (!material) {
    material = new MeshBasicMaterial({ color, toneMapped: false })
    flatCache.set(color, material)
  }
  return material
}

/** Call from an effect. Returns the release function to use as the effect cleanup. */
export function retainCargoMaterials(key: string): () => void {
  const entry = materialCache.get(key)
  if (!entry) return () => undefined
  entry.refs += 1
  if (entry.disposeTimer) {
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = null
  }
  return () => {
    entry.refs -= 1
    if (entry.refs > 0) return
    // Wait a moment: React may remount the same piece (step change, StrictMode) and want it back.
    entry.disposeTimer = setTimeout(() => {
      if (entry.refs > 0 || materialCache.get(key) !== entry) return
      materialCache.delete(key)
      if (key.startsWith("flat|")) {
        const color = key.slice(5)
        flatCache.get(color)?.dispose()
        flatCache.delete(color)
      } else {
        disposeMaterials(entry.materials)
      }
    }, 2000)
  }
}

/** Test helper. */
export function cargoMaterialCacheSize(): number {
  return materialCache.size
}

/** Test helper: forget everything without disposing (used between tests). */
export function resetCargoMaterialCache(): void {
  materialCache.clear()
  flatCache = new Map()
}

export function itemsOverlap(a: PlanItemView, b: PlanItemView): boolean {
  return bodiesOverlap(itemToPiece(a), itemToPiece(b), EPS)
}

export function clampToUnit(item: PlanItemView, unit: PlanUnitView): PlanItemView {
  if (item.shape === "CYLINDER_DRUM") {
    const radius = Math.min(item.lengthCm, item.widthCm) / 2
    const cx = clamp(item.x + item.lengthCm / 2, radius, unit.lengthCm - radius)
    const cy = clamp(item.y + item.widthCm / 2, radius, unit.widthCm - radius)
    return {
      ...item,
      x: cx - item.lengthCm / 2,
      y: cy - item.widthCm / 2,
      z: clamp(item.z, 0, Math.max(0, unit.heightCm - item.heightCm)),
    }
  }
  if (item.shape === "PIPE") {
    const alongLength = item.lengthCm >= item.widthCm
    const radius = alongLength
      ? Math.min(item.widthCm, item.heightCm) / 2
      : Math.min(item.lengthCm, item.heightCm) / 2
    const cx = alongLength
      ? clamp(item.x + item.lengthCm / 2, item.lengthCm / 2, unit.lengthCm - item.lengthCm / 2)
      : clamp(item.x + item.lengthCm / 2, radius, unit.lengthCm - radius)
    const cy = alongLength
      ? clamp(item.y + item.widthCm / 2, radius, unit.widthCm - radius)
      : clamp(item.y + item.widthCm / 2, item.widthCm / 2, unit.widthCm - item.widthCm / 2)
    const cz = clamp(item.z + item.heightCm / 2, radius, unit.heightCm - radius)
    return {
      ...item,
      x: cx - item.lengthCm / 2,
      y: cy - item.widthCm / 2,
      z: cz - item.heightCm / 2,
    }
  }
  return {
    ...item,
    x: clamp(item.x, 0, Math.max(0, unit.lengthCm - item.lengthCm)),
    y: clamp(item.y, 0, Math.max(0, unit.widthCm - item.widthCm)),
    z: clamp(item.z, 0, Math.max(0, unit.heightCm - item.heightCm)),
  }
}

export function footprintOverlapRatio(a: PlanItemView, b: PlanItemView): number {
  const dx = Math.min(a.x + a.lengthCm, b.x + b.lengthCm) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.widthCm, b.y + b.widthCm) - Math.max(a.y, b.y)
  const area = a.lengthCm * a.widthCm
  if (dx <= EPS || dy <= EPS || area <= EPS) return 0
  return (dx * dy) / area
}

export function stackHeightFor(item: PlanItemView, items: PlanItemView[]): number {
  let height = 0
  for (const other of items) {
    if (other.id === item.id) continue
    if (footprintOverlapRatio(item, other) < 0.3) continue
    height = Math.max(height, other.z + other.heightCm)
  }
  return height
}

export function tryPlaceItem(
  item: PlanItemView,
  items: PlanItemView[],
  unit: PlanUnitView,
): PlanItemView | null {
  return tryDragItem(item, items, unit)
}

export function tryDragItem(
  item: PlanItemView,
  items: PlanItemView[],
  unit: PlanUnitView,
  view: "iso" | "top" | "side" | "front" = "iso",
): PlanItemView | null {
  const desired = stackForView(item, items, view)
  const result = validateDrop(
    unitToWorld(unit),
    items.map(itemToPiece),
    itemToPiece(desired),
    { x: desired.x, y: desired.y, z: desired.z },
    {
      clampToWalls: true,
      minSupportRatio: 0.7,
      maxPayloadKg: unit.maxPayloadKg > 0 ? unit.maxPayloadKg : null,
      strictMode: true,
    },
  )
  if (!result.valid) return null
  const next = applyDropPosition(desired, result.position)
  if (!fitsContour(next, unit)) return null
  return next
}

function stackForView(
  item: PlanItemView,
  items: PlanItemView[],
  view: "iso" | "top" | "side" | "front",
): PlanItemView {
  const support = bestSupport(item, items, view)
  if ((view === "side" || view === "front") && support && item.z >= support.z + support.heightCm * 0.35) {
    return {
      ...item,
      z: support.z + support.heightCm,
      x: view === "front" ? alignOn(item.x, item.lengthCm, support.x, support.lengthCm) : item.x,
      y: view === "side" ? alignOn(item.y, item.widthCm, support.y, support.widthCm) : item.y,
    }
  }
  return { ...item, z: stackHeightFor(item, items) }
}

function bestSupport(
  item: PlanItemView,
  items: PlanItemView[],
  view: "iso" | "top" | "side" | "front",
): PlanItemView | null {
  let best: PlanItemView | null = null
  let top = -1
  for (const other of items) {
    if (other.id === item.id) continue
    const overlap =
      view === "front" ? spanOverlap(item.y, item.widthCm, other.y, other.widthCm) : spanOverlap(item.x, item.lengthCm, other.x, other.lengthCm)
    if (overlap < 0.35) continue
    const otherTop = other.z + other.heightCm
    if (otherTop > top) {
      best = other
      top = otherTop
    }
  }
  return best
}

function spanOverlap(a: number, aSize: number, b: number, bSize: number): number {
  const overlap = Math.min(a + aSize, b + bSize) - Math.max(a, b)
  return aSize > EPS && overlap > 0 ? overlap / aSize : 0
}

function alignOn(pos: number, size: number, base: number, baseSize: number): number {
  if (pos < base + baseSize - EPS && pos + size > base + EPS) return pos
  return base + Math.max(0, (baseSize - size) / 2)
}

export function rotateItemFlat(item: PlanItemView): PlanItemView {
  return {
    ...item,
    lengthCm: item.widthCm,
    widthCm: item.lengthCm,
    rotation: item.rotation === "LWH" ? "WLH" : "LWH",
  }
}

export function fitsContour(item: PlanItemView, unit: PlanUnitView): boolean {
  const contour = toSolverContour(unit.contour)
  if (!contour) return true
  const equipment: SolverEquipment = {
    id: unit.equipmentId,
    name: unit.equipmentName,
    lengthCm: unit.lengthCm,
    widthCm: unit.widthCm,
    heightCm: unit.heightCm,
    maxPayloadKg: unit.maxPayloadKg,
    tareKg: 0,
    axleGroups: [],
    costPerUnit: 0,
    maxCount: 1,
    contour,
  }
  return boxFitsContour(
    { x: item.x, y: item.y, z: item.z, l: item.lengthCm, w: item.widthCm, h: item.heightCm },
    equipment,
  )
}

function toSolverContour(contour: UldContour | null) {
  if (!contour || !hasContourCuts(contour)) return null
  return {
    bottomLeft: mm(contour.bottomLeft),
    bottomRight: mm(contour.bottomRight),
    topLeft: mm(contour.topLeft),
    topRight: mm(contour.topRight),
  }
}

function mm(side: { lengthMm: number; heightMm: number }) {
  return { lengthCm: side.lengthMm / 10, heightCm: side.heightMm / 10 }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
