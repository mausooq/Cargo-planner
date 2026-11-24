"use client"

import { Line, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { validateDrop } from "@compass/physics"
import { createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { BoxGeometry, EdgesGeometry, Group, Plane, Raycaster, Vector2, Vector3 } from "three"
import { CylinderOutline } from "@/components/cylinder-outline"
import { DimensionMarks } from "@/components/dimension-marks"
import { GhostMesh } from "@/components/ghost-mesh"
import { PlanDiagram } from "@/components/plan-diagram"
import { WebGLGuard } from "@/components/webgl-guard"
import { PipeMesh, pipeInnerRadius } from "@/components/pipe-mesh"
import { AirContourMesh, AirPalletMesh } from "@/components/equipment-hull"
import { applyDropPosition, itemToPiece, pointerInFootprint, unitToWorld } from "@/lib/cargo-physics"
import { snapToNeighbours, snapToStack } from "@/lib/cargo-snap"
import { fallDurationMs, fallHeight, prefersReducedMotion } from "@/lib/fall-motion"
import { cargoLabelParts } from "@/lib/cargo-label"
import { fitsContour, getCargoMaterials, retainCargoMaterials } from "@/lib/cargo-skin"
import { ghostColors, physicsFromSettings, useEditorSettings } from "@/lib/editor-settings"
import { visualKind } from "@/lib/equipment-shape"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"
import { resolveEquipmentContour, uldContourVolumeM3 } from "@/lib/uld-contour"
import { cn } from "@/lib/utils"

const SCALE = 0.01
const SELECTED_COLOR = "#f59e0b"
export type ViewerCamera = "iso" | "top" | "side" | "front"
const OrbitLockContext = createContext<(on: boolean) => void>(() => undefined)

function useOrbitLock() {
  return useContext(OrbitLockContext)
}

type DragPreview = {
  /** What snapping did, for the tooltip, e.g. "Lined up on top of oil" or "Against the wall". */
  snappedOn?: string
  itemId: string
  origin: PlanItemView
  ghost: PlanItemView
  valid: boolean
  message: string
  clientX: number
  clientY: number
}

type PieceAnim = {
  id: string
  from: PlanItemView
  to: PlanItemView
  start: number
  mode: "commit" | "reject"
}

export function LoadViewer({
  unit,
  camera = "iso",
  className,
  compact = false,
  playground = false,
  selectedId = null,
  onSelect,
  onItemsChange,
  onDragActive,
  flashItem = null,
  onDropPiece,
}: {
  /** Called when a set-aside piece is dropped on the container: its id and the floor point (cm). */
  onDropPiece?: (id: string, at: { x: number; y: number }) => void
  unit: PlanUnitView
  camera?: ViewerCamera
  className?: string
  compact?: boolean
  playground?: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onItemsChange?: (items: PlanItemView[]) => void
  onDragActive?: (active: boolean) => void
  flashItem?: PlanItemView | null
}) {
  const length = unit.lengthCm * SCALE
  const width = unit.widthCm * SCALE
  const height = unit.heightCm * SCALE
  const contour = resolveEquipmentContour(unit.equipmentName, unit.contour)
  const kind = visualKind({
    mode: unit.equipmentMode,
    name: unit.equipmentName,
    heightOpen: unit.heightOpen,
    oogClass: unit.oogClass,
    contour,
  })
  const volumeM3 = uldContourVolumeM3(unit.lengthCm, unit.widthCm, unit.heightCm, contour)
  const [orbitOn, setOrbitOn] = useState(true)
  const position = useMemo<[number, number, number]>(() => cameraPosition(camera, length, width, height), [camera, height, length, width])
  const target = useMemo<[number, number, number]>(() => {
    if (camera === "side" || camera === "front") return [0, height * 0.38, 0]
    if (camera === "top") return [0, 0, 0]
    return [0, height / 2, 0]
  }, [camera, height])
  const fov = camera === "iso" ? 35 : 22
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [shellSelected, setShellSelected] = useState(false)
  const [anim, setAnim] = useState<PieceAnim | null>(null)
  const settings = useEditorSettings()
  const colors = ghostColors(settings.colourBlindPalette)
  // Paint the page (and a loading message) first, then build the 3D scene on the next tick,
  // so opening a big plan never looks frozen.
  const [mounted, setMounted] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 30)
    return () => window.clearTimeout(timer)
  }, [])

  // Drop target for set-aside pieces dragged in from the playground's left panel.
  const floorPicker = useRef<FloorPick | null>(null)
  const [dropHover, setDropHover] = useState(false)
  const acceptsDrop = (event: React.DragEvent) => Boolean(onDropPiece) && event.dataTransfer.types.includes(PIECE_DRAG_TYPE)

  return (
    <div
      className={cn(
        "relative",
        className ?? "h-[28rem] w-full overflow-hidden rounded-md border bg-white",
        dropHover && "ring-4 ring-inset ring-emerald-500/60",
      )}
      style={{ cursor: preview ? (preview.valid ? "grabbing" : "not-allowed") : undefined }}
      onDragOver={(event) => {
        if (!acceptsDrop(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        if (!dropHover) setDropHover(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropHover(false)
      }}
      onDrop={(event) => {
        if (!acceptsDrop(event)) return
        event.preventDefault()
        setDropHover(false)
        const id = event.dataTransfer.getData(PIECE_DRAG_TYPE)
        const at = floorPicker.current?.(event.clientX, event.clientY)
        if (id && at) onDropPiece?.(id, at)
      }}
    >
      {!mounted ? <ViewerLoading compact={compact} pieces={unit.items.length} /> : null}
      {mounted ? (
      <WebGLGuard
        compact={compact}
        // If the browser cannot do 3D, show the same plan as a flat drawing instead of crashing.
        fallback={<PlanDiagram unit={unit} view={camera === "iso" ? "side" : camera} bare={compact} className="h-full w-full" />}
      >
      {(onContextLost) => (
      <>
      {!ready ? <ViewerLoading compact={compact} pieces={unit.items.length} /> : null}
      <Canvas
        onCreated={({ gl }) => {
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault()
              onContextLost()
            },
            { once: true },
          )
          // One more tick so the first frame is on screen before the message goes away.
          window.setTimeout(() => setReady(true), 0)
        }}
        // Draw only when something changes (camera move, drag, animation) instead of 60 times a second.
        frameloop="demand"
        camera={{ position, fov }}
        dpr={[1, 1.5]}
        flat
        // "default" lets the browser pick the GPU; forcing "high-performance" made weaker laptops crash more often.
        gl={{ antialias: true, alpha: false, powerPreference: "default" }}
      >
        <color attach="background" args={["#ffffff"]} />
        <ambientLight intensity={0.4} />
        <hemisphereLight args={["#f7f7f7", "#c4c4c4", 0.35]} />
        <directionalLight position={[5, 11, 7]} intensity={1.2} />
        <directionalLight position={[-7, 3, -4]} intensity={0.28} />
        <OrbitLockContext.Provider value={setOrbitOn}>
        <group position={[-length / 2, 0, -width / 2]}>
          {kind === "AIR_CONTOUR" ? (
            <AirContourMesh length={length} width={width} height={height} contour={contour} />
          ) : kind === "AIR_PALLET" ? (
            <AirPalletMesh name={unit.equipmentName} length={length} width={width} height={height} />
          ) : (
            <ContainerShell
              length={length}
              width={width}
              height={height}
              selected={shellSelected && !selectedId}
              onSelect={
                playground
                  ? () => {
                      setShellSelected(true)
                      onSelect?.(null)
                    }
                  : undefined
              }
            />
          )}
          {unit.items.map((entry) => (
            <CargoPiece
              key={entry.id}
              item={entry}
              unit={unit}
              camera={camera}
              playground={playground}
              selected={selectedId === entry.id}
              preview={preview}
              anim={anim}
              onSelect={onSelect}
              onItemsChange={onItemsChange}
              onPreview={setPreview}
              onAnim={setAnim}
              onDragActive={onDragActive}
              simple={compact}
            />
          ))}
          {preview ? (
            <GhostMesh item={preview.ghost} valid={preview.valid} validColor={colors.valid} invalidColor={colors.invalid} />
          ) : flashItem ? (
            <GhostMesh item={flashItem} valid={false} validColor={colors.valid} invalidColor={colors.invalid} />
          ) : null}
          <WallAlert length={length} width={width} height={height} active={Boolean((preview && !preview.valid) || flashItem)} />
          {!compact ? (
            <mesh position={[unit.cog.x * SCALE, unit.cog.z * SCALE + 0.04, unit.cog.y * SCALE]}>
              <sphereGeometry args={[0.05, 16, 16]} />
              <meshBasicMaterial color="#e24b4b" toneMapped={false} />
            </mesh>
          ) : null}
          {!compact && !playground ? (
            <Suspense fallback={null}>
              <DimensionMarks
                length={length}
                width={width}
                height={height}
                lengthCm={unit.lengthCm}
                widthCm={unit.widthCm}
                heightCm={unit.heightCm}
                volumeM3={volumeM3}
                contour={contour}
              />
            </Suspense>
          ) : null}
        </group>
        </OrbitLockContext.Provider>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.12}
          enabled={orbitOn}
          enablePan
          enableZoom
          enableRotate={camera === "iso"}
          target={target}
        />
        <CameraSync position={position} target={target} />
        {onDropPiece ? <FloorPicker pickRef={floorPicker} length={length} width={width} /> : null}
      </Canvas>
      </>
      )}
      </WebGLGuard>
      ) : null}
      {preview ? <DragTooltip preview={preview} validColor={colors.valid} invalidColor={colors.invalid} /> : null}
    </div>
  )
}

/**
 * Moves the camera when the view (Iso / Top / Right / Front) changes. The canvas draws on demand,
 * so it also asks for a frame; before, the always-on render loop happened to pick the change up.
 */
function CameraSync({ position, target }: { position: [number, number, number]; target: [number, number, number] }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as { target: Vector3; update: () => void } | null
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    camera.position.set(...position)
    if (controls) {
      controls.target.set(...target)
      controls.update()
    } else {
      camera.lookAt(...target)
    }
    invalidate()
  }, [camera, controls, invalidate, position, target])
  return null
}

/** Drag data type for set-aside pieces; the playground's left panel sets it, the viewer accepts it. */
export const PIECE_DRAG_TYPE = "application/x-compass-piece"

type FloorPick = (clientX: number, clientY: number) => { x: number; y: number } | null

/** Turns a screen point into a floor position in the unit (cm), for drops from outside the canvas. */
function FloorPicker({
  pickRef,
  length,
  width,
}: {
  pickRef: React.MutableRefObject<FloorPick | null>
  length: number
  width: number
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const raycaster = new Raycaster()
    const floor = new Plane(new Vector3(0, 1, 0), 0)
    const hit = new Vector3()
    pickRef.current = (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect()
      raycaster.setFromCamera(
        new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
        camera,
      )
      if (!raycaster.ray.intersectPlane(floor, hit)) return null
      // The scene is centred: world x = unit x - length / 2, world z = unit y - width / 2 (in metres).
      return { x: (hit.x + length / 2) / SCALE, y: (hit.z + width / 2) / SCALE }
    }
    return () => {
      pickRef.current = null
    }
  }, [camera, gl, length, pickRef, width])
  return null
}

function ViewerLoading({ compact, pieces }: { compact: boolean; pieces: number }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-neutral-700"
      role="status"
      aria-live="polite"
    >
      {compact ? (
        <span className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-emerald-700" aria-hidden="true" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-sm">
          <span className="size-7 animate-spin rounded-full border-2 border-neutral-300 border-t-emerald-700" aria-hidden="true" />
          <span>Preparing 3D view{pieces > 50 ? ` (${pieces} pieces)` : ""}…</span>
        </div>
      )}
      <span className="sr-only">Loading 3D view</span>
    </div>
  )
}

function cameraPosition(
  camera: ViewerCamera,
  length: number,
  width: number,
  height: number,
): [number, number, number] {
  const reach = Math.max(length, width, height)
  if (camera === "top") return [0, Math.max(height * 2.8, reach * 1.6, 4), 0.01]
  if (camera === "side") return [0, height * 0.38, Math.max(length * 1.25, 8)]
  if (camera === "front") return [Math.max(length * 1.25, 8), height * 0.38, 0]
  return [reach * 0.95, height * 0.85, reach * 0.95]
}

function CargoPiece({
  item,
  unit,
  camera,
  playground,
  selected,
  preview,
  anim,
  onSelect,
  onItemsChange,
  onPreview,
  onAnim,
  onDragActive,
  simple = false,
}: {
  simple?: boolean
  item: PlanItemView
  unit: PlanUnitView
  camera: ViewerCamera
  playground: boolean
  selected: boolean
  preview: DragPreview | null
  anim: PieceAnim | null
  onSelect?: (id: string | null) => void
  onItemsChange?: (items: PlanItemView[]) => void
  onPreview: (preview: DragPreview | null) => void
  onAnim: (anim: PieceAnim | null) => void
  onDragActive?: (active: boolean) => void
}) {
  const length = item.lengthCm * SCALE
  const width = item.widthCm * SCALE
  const height = item.heightCm * SCALE
  const drum = item.shape === "CYLINDER_DRUM"
  const pipe = item.shape === "PIPE"
  const alongLength = pipe && item.lengthCm >= item.widthCm
  const radius = drum
    ? Math.min(length, width) / 2
    : pipe
      ? alongLength
        ? Math.min(width, height) / 2
        : Math.min(length, height) / 2
      : 0
  const tube = pipe ? (alongLength ? length : width) : height
  const rotation: [number, number, number] = pipe ? (alongLength ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]) : [0, 0, 0]
  const [dragging, setDragging] = useState(false)
  const grab = useRef({ dx: 0, dy: 0, dz: 0 })
  const originRef = useRef(item)
  const itemRef = useRef(item)
  const unitRef = useRef(unit)
  const viewRef = useRef(camera)
  const previewRef = useRef(preview)
  const group = useRef<Group>(null)
  const { camera: threeCamera, gl, raycaster, invalidate } = useThree()
  const setOrbit = useOrbitLock()
  const settings = useEditorSettings()

  // What is printed on the piece: its mark on its own line (unless the name already shows it), then the name.
  const label = useMemo(() => cargoLabelParts(item.sku, item.name), [item.sku, item.name])

  // Shared across identical pieces and viewers (see getCargoMaterials). Small views use flat colour.
  const { key: materialKey, materials } = useMemo(
    () =>
      getCargoMaterials({
        color: selected ? SELECTED_COLOR : item.color,
        label: label.text,
        mark: label.mark,
        length,
        width,
        height,
        round: drum || pipe,
        simple,
      }),
    [drum, pipe, item.color, label.text, label.mark, length, width, height, selected, simple],
  )

  useEffect(() => retainCargoMaterials(materialKey), [materialKey])

  useEffect(() => {
    itemRef.current = item
    unitRef.current = unit
    viewRef.current = camera
    previewRef.current = preview
  }, [camera, item, preview, unit])

  // The canvas draws on demand, and this piece is positioned inside useFrame, so ask for a frame
  // whenever anything that moves it changes: a new position (drag, arrow keys, rotate, undo),
  // the drag preview, the selection colour, or the start of a snap/shake animation.
  useEffect(() => {
    invalidate()
  }, [invalidate, item, preview, anim, dragging, selected, materials])

  // Smooth falling: when gravity lowers this piece (something under it was moved away), animate
  // from the old height to the new one instead of jumping. Rises (undo, reset) stay instant.
  const restingZ = useRef(item.z)
  const fall = useRef<{ from: number; to: number; start: number; ms: number } | null>(null)
  useEffect(() => {
    const previous = restingZ.current
    restingZ.current = item.z
    const ownMove = dragging || (anim !== null && anim.id === item.id)
    if (!playground || ownMove || prefersReducedMotion()) {
      fall.current = null
      return
    }
    if (previous - item.z > 0.5) {
      const active = fall.current
      // If it was already falling, carry on from where it is now rather than restarting at the top.
      const from = active
        ? fallHeight(active.from, active.to, Math.min(1, (performance.now() - active.start) / active.ms))
        : previous
      fall.current = { from, to: item.z, start: performance.now(), ms: fallDurationMs(from - item.z) }
      invalidate()
    } else if (item.z > previous) {
      fall.current = null
    }
  }, [anim, dragging, invalidate, item.id, item.z, playground])

  useFrame((state) => {
    const mesh = group.current
    if (!mesh) return
    const now = performance.now()
    const falling = fall.current
    if (falling && !(anim && anim.id === item.id)) {
      const t = Math.min(1, (now - falling.start) / falling.ms)
      const z = fallHeight(falling.from, falling.to, t)
      mesh.position.set(
        (item.x + item.lengthCm / 2) * SCALE,
        (z + item.heightCm / 2) * SCALE,
        (item.y + item.widthCm / 2) * SCALE,
      )
      if (t >= 1) fall.current = null
      else state.invalidate()
      return
    }
    if (anim && anim.id === item.id) {
      const span = anim.mode === "commit" ? 120 : 220
      const t = Math.min(1, (now - anim.start) / span)
      const ease = anim.mode === "commit" ? 1 - (1 - t) * (1 - t) : t
      const from = anim.mode === "commit" ? anim.from : anim.to
      const to = anim.mode === "commit" ? anim.to : anim.to
      const shake = anim.mode === "reject" ? Math.sin(now / 18) * 1.2 * (1 - t) : 0
      const x = from.x + (to.x - from.x) * ease + shake
      const y = from.y + (to.y - from.y) * ease
      const z = from.z + (to.z - from.z) * ease
      mesh.position.set(
        (x + item.lengthCm / 2) * SCALE,
        (z + item.heightCm / 2) * SCALE,
        (y + item.widthCm / 2) * SCALE,
      )
      if (t >= 1) onAnim(null)
      // On-demand rendering: ask for the next frame until the snap or shake finishes.
      else state.invalidate()
      return
    }
    const shown =
      dragging && settings.moveRealPieceWhileDragging && preview?.itemId === item.id ? preview.ghost : item
    mesh.position.set(
      (shown.x + item.lengthCm / 2) * SCALE,
      (shown.z + item.heightCm / 2) * SCALE,
      (shown.y + item.widthCm / 2) * SCALE,
    )
  })

  useEffect(() => {
    if (!dragging || !playground || !onItemsChange) return
    const updateItems = onItemsChange
    const plane = new Plane()
    const hit = new Vector3()
    const canvas = gl.domElement
    let frame = 0
    let pending: PointerEvent | null = null

    function apply(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect()
      raycaster.setFromCamera(
        new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1),
        threeCamera,
      )
      const current = originRef.current
      const live = unitRef.current
      const view = viewRef.current
      const point = hitOnDragPlane(plane, hit, raycaster.ray, view, current, live)
      if (!point) return
      const free = draggedItem(current, live, view, point, grab.current)
      const unitX = point.x / SCALE + live.lengthCm / 2
      const unitY = point.z / SCALE + live.widthCm / 2
      const outside = !pointerInFootprint(unitX, unitY, live)
      const editor = useEditorSettings.getState()
      const physics = physicsFromSettings(editor, live.maxPayloadKg)
      const others = live.items.map(itemToPiece)
      const check = (candidate: PlanItemView) =>
        validateDrop(unitToWorld(live), others, itemToPiece(candidate), { x: candidate.x, y: candidate.y, z: candidate.z }, physics)
      // Snapping aids. Over another box: line up exactly on top of it. Otherwise: slide flush
      // against a neighbour in the same row or a wall. A snap is kept only if it is still a valid
      // drop (or the free spot is invalid anyway); otherwise the piece goes exactly where the pointer is.
      const neighbours = live.items.filter((entry) => entry.id !== current.id)
      const axes = { x: view !== "front", y: view !== "side" }
      let desired = free
      let result = check(free)
      let snappedOn: string | undefined
      const adopt = (candidate: PlanItemView, label: string) => {
        const snapped = check(candidate)
        if (snapped.valid || !result.valid) {
          desired = candidate
          result = snapped
          snappedOn = label
          return true
        }
        return false
      }
      if (editor.snapToStack) {
        const stack = snapToStack(free, neighbours, axes)
        const stacked = stack.target ? adopt(stack.item, `Lined up on top of ${stack.target.name}`) : false
        if (!stacked) {
          const side = snapToNeighbours(free, neighbours, live, axes)
          if (side.against) adopt(side.item, side.against.startsWith("the ") ? `Against ${side.against}` : `Flush against ${side.against}`)
        }
      }
      const ghost = applyDropPosition(desired, result.position)
      const contourOk = fitsContour(ghost, live)
      const valid = !outside && result.valid && contourOk
      onPreview({
        itemId: current.id,
        origin: current,
        ghost: outside ? { ...desired, z: 0 } : ghost,
        valid,
        message: outside || !contourOk ? "Outside container" : result.message,
        snappedOn: valid ? snappedOn : undefined,
        clientX: event.clientX,
        clientY: event.clientY,
      })
      document.body.style.cursor = valid ? "grabbing" : "not-allowed"
    }

    function moveTo(event: PointerEvent) {
      pending = event
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pending) apply(pending)
      })
    }

    function onUp() {
      const next = previewRef.current
      setDragging(false)
      onDragActive?.(false)
      document.body.style.cursor = ""
      setOrbit(true)
      onPreview(null)
      if (!next || next.itemId !== originRef.current.id) return
      if (next.valid) {
        onAnim({ id: next.itemId, from: originRef.current, to: next.ghost, start: performance.now(), mode: "commit" })
        updateItems(unitRef.current.items.map((entry) => (entry.id === next.itemId ? next.ghost : entry)))
        return
      }
      onAnim({ id: next.itemId, from: originRef.current, to: originRef.current, start: performance.now(), mode: "reject" })
      toast.error(next.message)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      setDragging(false)
      onDragActive?.(false)
      document.body.style.cursor = ""
      setOrbit(true)
      onPreview(null)
      onAnim({ id: originRef.current.id, from: originRef.current, to: originRef.current, start: performance.now(), mode: "reject" })
    }

    window.addEventListener("pointermove", moveTo)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", moveTo)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("keydown", onKey)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [dragging, gl.domElement, onAnim, onDragActive, onItemsChange, onPreview, playground, raycaster, setOrbit, threeCamera])

  return (
    <group
      ref={group}
      position={[
        (item.x + item.lengthCm / 2) * SCALE,
        (item.z + item.heightCm / 2) * SCALE,
        (item.y + item.widthCm / 2) * SCALE,
      ]}
    >
      <group
        rotation={rotation}
        onPointerOver={() => {
          if (playground && !dragging) document.body.style.cursor = "grab"
        }}
        onPointerOut={() => {
          if (!dragging) document.body.style.cursor = ""
        }}
        onPointerDown={(event) => {
          if (!playground) return
          event.stopPropagation()
          originRef.current = item
          grab.current = {
            dx: event.point.x / SCALE + unit.lengthCm / 2 - item.x,
            dy: event.point.z / SCALE + unit.widthCm / 2 - item.y,
            dz: event.point.y / SCALE - item.z,
          }
          setDragging(true)
          onDragActive?.(true)
          document.body.style.cursor = "grabbing"
          setOrbit(false)
          onSelect?.(item.id)
        }}
      >
        {pipe ? (
          <PipeMesh radius={radius} length={tube} material={materials[0]!} />
        ) : drum ? (
          <mesh material={materials[0]}>
            <cylinderGeometry args={[radius, radius, tube, 64]} />
          </mesh>
        ) : (
          <mesh material={materials}>
            <boxGeometry args={[length, height, width]} />
          </mesh>
        )}
      </group>
      {drum || pipe ? (
        <CylinderOutline
          radius={radius}
          length={tube}
          rotation={rotation}
          innerRadius={pipe ? pipeInnerRadius(radius) : undefined}
          color={selected ? "#9a3412" : "#1a1a1a"}
        />
      ) : (
        <CargoOutline length={length} width={width} height={height} selected={selected} />
      )}
    </group>
  )
}

function hitOnDragPlane(
  plane: Plane,
  hit: Vector3,
  ray: { intersectPlane: (plane: Plane, target: Vector3) => Vector3 | null },
  view: ViewerCamera,
  item: PlanItemView,
  unit: PlanUnitView,
): Vector3 | null {
  if (view === "side") {
    const zWorld = (item.y + item.widthCm / 2) * SCALE - (unit.widthCm * SCALE) / 2
    plane.setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1), new Vector3(0, 0, zWorld))
  } else if (view === "front") {
    const xWorld = (item.x + item.lengthCm / 2) * SCALE - (unit.lengthCm * SCALE) / 2
    plane.setFromNormalAndCoplanarPoint(new Vector3(1, 0, 0), new Vector3(xWorld, 0, 0))
  } else {
    plane.setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), new Vector3(0, item.z * SCALE, 0))
  }
  return ray.intersectPlane(plane, hit)
}

function draggedItem(
  item: PlanItemView,
  unit: PlanUnitView,
  view: ViewerCamera,
  point: Vector3,
  grab: { dx: number; dy: number; dz: number },
): PlanItemView {
  if (view === "side") {
    return {
      ...item,
      x: point.x / SCALE + unit.lengthCm / 2 - grab.dx,
      z: Math.max(0, point.y / SCALE - grab.dz),
    }
  }
  if (view === "front") {
    return {
      ...item,
      y: point.z / SCALE + unit.widthCm / 2 - grab.dy,
      z: Math.max(0, point.y / SCALE - grab.dz),
    }
  }
  return {
    ...item,
    x: point.x / SCALE + unit.lengthCm / 2 - grab.dx,
    y: point.z / SCALE + unit.widthCm / 2 - grab.dy,
  }
}

function CargoOutline({
  length,
  width,
  height,
  selected,
}: {
  length: number
  width: number
  height: number
  selected: boolean
}) {
  const geometry = useMemo(() => {
    const box = new BoxGeometry(length, height, width)
    const edges = new EdgesGeometry(box)
    box.dispose()
    return edges
  }, [height, length, width])

  useEffect(() => () => geometry?.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={selected ? "#9a3412" : "#2c2c2c"} toneMapped={false} />
    </lineSegments>
  )
}

function ContainerShell({
  length,
  width,
  height,
  selected = false,
  onSelect,
}: {
  length: number
  width: number
  height: number
  selected?: boolean
  onSelect?: () => void
}) {
  const corners: [number, number, number][] = [
    [0, 0, 0],
    [length, 0, 0],
    [length, 0, width],
    [0, 0, width],
    [0, height, 0],
    [length, height, 0],
    [length, height, width],
    [0, height, width],
  ]
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[length / 2, 0, width / 2]}
        onPointerDown={(event) => {
          if (!onSelect) return
          event.stopPropagation()
          onSelect()
        }}
      >
        <planeGeometry args={[length, width]} />
        <meshBasicMaterial color={selected ? SELECTED_COLOR : "#c8c8c8"} toneMapped={false} />
      </mesh>
      <mesh
        position={[length, height / 2, width / 2]}
        rotation={[0, Math.PI / 2, 0]}
        onPointerDown={(event) => {
          if (!onSelect) return
          event.stopPropagation()
          onSelect()
        }}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          color={selected ? "#fde68a" : "#d7efe3"}
          transparent
          opacity={selected ? 0.72 : 0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {edges.map(([a, b]) => {
        const start = corners[a]
        const end = corners[b]
        if (!start || !end) return null
        return <Line key={`${a}-${b}`} points={[start, end]} color={selected ? "#b45309" : "#5b5b5b"} lineWidth={selected ? 2 : 1} />
      })}
    </group>
  )
}

function WallAlert({
  length,
  width,
  height,
  active,
}: {
  length: number
  width: number
  height: number
  active: boolean
}) {
  if (!active) return null
  const corners: [number, number, number][] = [
    [0, 0, 0],
    [length, 0, 0],
    [length, 0, width],
    [0, 0, width],
    [0, height, 0],
    [length, height, 0],
    [length, height, width],
    [0, height, width],
  ]
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  return (
    <group>
      {edges.map(([a, b]) => {
        const start = corners[a]
        const end = corners[b]
        if (!start || !end) return null
        return <Line key={`alert-${a}-${b}`} points={[start, end]} color="#ef4444" lineWidth={2} />
      })}
    </group>
  )
}

function DragTooltip({
  preview,
  validColor,
  invalidColor,
}: {
  preview: DragPreview
  validColor: string
  invalidColor: string
}) {
  return (
    <div
      className="pointer-events-none fixed z-[80] flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs shadow-sm"
      style={{ left: preview.clientX + 14, top: preview.clientY + 16 }}
    >
      <span
        aria-hidden
        className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: preview.valid ? validColor : invalidColor }}
      >
        {preview.valid ? "✓" : "×"}
      </span>
      <span>
        {preview.valid ? (preview.snappedOn ?? "Valid position") : preview.message}
      </span>
    </div>
  )
}
