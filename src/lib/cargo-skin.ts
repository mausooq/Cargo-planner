import { CanvasTexture, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Material } from "three"
import { bodiesOverlap, validateDrop } from "@compass/physics"
import { boxFitsContour, type SolverEquipment } from "@compass/solver"
import { applyDropPosition, itemToPiece, unitToWorld } from "@/lib/cargo-physics"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"
import { cargoLabelColor } from "@/lib/format"
import { hasContourCuts, type UldContour } from "@/lib/uld-contour"

const EPS = 0.05

export function makeFaceTexture(input: {
  color: string
  label?: string
  hatch?: boolean
  aspect: number
}): CanvasTexture | null {
  if (typeof document === "undefined") return null
  const width = 512
  const height = Math.max(128, Math.round(512 / Math.max(input.aspect, 0.35)))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  ctx.fillStyle = input.color
  ctx.fillRect(0, 0, width, height)

  if (input.hatch) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)"
    ctx.lineWidth = 10
    const step = 28
    for (let x = -height; x < width + height; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + height, height)
      ctx.stroke()
    }
  }

  const label = input.label?.trim()
  if (label) {
    ctx.fillStyle = cargoLabelColor(input.color)
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const lines = wrapLabel(ctx, label.toUpperCase(), width * 0.86, height * 0.8)
    const size = Math.min(64, Math.round(height / (lines.length + 1.2)))
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`
    const start = height / 2 - ((lines.length - 1) * size * 0.6) / 2
    for (const [index, line] of lines.entries()) {
      ctx.fillText(line, width / 2, start + index * size * 0.7)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function wrapLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  ctx.font = "700 48px ui-sans-serif, system-ui, sans-serif"
  const lines: string[] = []
  let current = words[0] as string
  for (const word of words.slice(1)) {
    const trial = `${current} ${word}`
    if (ctx.measureText(trial).width <= maxWidth) current = trial
    else {
      lines.push(current)
      current = word
    }
  }
  lines.push(current)
  const maxLines = Math.max(1, Math.floor(maxHeight / 36))
  return lines.slice(0, maxLines)
}

export function cargoBoxMaterials(color: string, label: string, length: number, width: number, height: number) {
  const ink = label.trim() || "Cargo"
  const side = (aspect: number, hatch = false, withLabel = true) => {
    const map = makeFaceTexture({ color, label: withLabel ? ink : undefined, hatch, aspect }) ?? undefined
    return new MeshBasicMaterial({ map, color: map ? "#ffffff" : color, toneMapped: false })
  }

  const top = side(Math.max(length / Math.max(width, 0.01), 0.4), true, true)
  const bottom = new MeshBasicMaterial({ color, toneMapped: false })
  const alongWidth = side(Math.max(length / Math.max(height, 0.01), 0.4))
  const alongLength = side(Math.max(width / Math.max(height, 0.01), 0.4))
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
    if ("map" in material && material.map) material.map.dispose()
    material.dispose()
  }
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
