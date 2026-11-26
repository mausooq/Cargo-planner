import { snapBoxToContour } from "./contour"
import { contains, EPS, intersects, orientationsFor, overlapArea, volume, type Box, type Dims } from "./geometry"
import { axleLoads, axleViolation } from "./metrics"
import { computeUnitMetrics } from "./unit-metrics"
import type { Placement, SolverCargo, SolverEquipment, SolverSettings, UnitMetrics, UnloadedReason } from "./types"

export type Instance = {
  cargo: SolverCargo
  instanceIndex: number
}

type Placed = Box & {
  instance: Instance
  rotation: string
  layer: number
  /** Weight resting on this item, in kilograms. */
  loadAbove: number
  supporters: Placed[]
  sequence: number
}

export type Rejection = { reason: UnloadedReason; detail: string }

/**
 * One container being filled with the maximal-spaces heuristic.
 * Items go bottom first, then front first, then left first.
 */
export class Unit {
  readonly equipment: SolverEquipment
  readonly placed: Placed[] = []
  readonly classes = new Set<string>()
  netKg = 0
  private spaces: Box[]
  private readonly settings: SolverSettings

  constructor(equipment: SolverEquipment, settings: SolverSettings) {
    this.equipment = equipment
    this.settings = settings
    this.spaces = [{ x: 0, y: 0, z: 0, l: equipment.lengthCm, w: equipment.widthCm, h: equipment.heightCm }]
  }

  get count(): number {
    return this.placed.length
  }

  tryPlace(instance: Instance): Rejection | null {
    const cargo = instance.cargo
    if (this.netKg + cargo.weightKg > this.equipment.maxPayloadKg + EPS) {
      return { reason: "TOO_HEAVY", detail: `${cargo.name} would exceed the ${this.equipment.name} payload.` }
    }
    if (cargo.segregationClass && this.conflicts(cargo.segregationClass)) {
      return { reason: "SEGREGATION", detail: `${cargo.name} may not share a unit with its loaded classes.` }
    }

    const dims = orientationsFor(cargo)
    let best: { box: Box; dims: Dims; supporters: Placed[]; layer: number; score: number } | null = null
    let sawDimsFit = false
    let stackRejected = false
    let axleRejected = false

    const sorted = this.spaces.slice().sort(compareSpaces)
    for (const space of sorted) {
      for (const dim of dims) {
        const box = snapBoxToContour(space, dim, this.equipment)
        if (!box) continue
        sawDimsFit = true
        if (cargo.bottomOnly && box.z > EPS) {
          stackRejected = true
          continue
        }
        const support = this.supportFor(box, cargo)
        if (!support) {
          stackRejected = true
          continue
        }
        const layer = support.layer
        if (cargo.maxStackLayers !== null && layer > cargo.maxStackLayers) {
          stackRejected = true
          continue
        }
        if (!this.axlesOk(box, cargo.weightKg)) {
          axleRejected = true
          continue
        }
        const score =
          box.z * 1e9 +
          box.x * 1e5 +
          box.y * 10 +
          (space.w - dim.w) * 0.01 +
          dim.h * 0.001
        if (!best || score < best.score) {
          best = { box, dims: dim, supporters: support.supporters, layer, score }
        }
      }
      if (best && best.box.z <= EPS) break
    }

    if (!best) {
      if (!sawDimsFit) {
        if (!fitsAnywhereEmpty(this.equipment, dims)) {
          return { reason: "OUT_OF_GAUGE", detail: `${cargo.name} does not fit inside ${this.equipment.name} in any allowed orientation.` }
        }
        return { reason: "NO_SPACE", detail: `No free space left for ${cargo.name}.` }
      }
      if (axleRejected && !stackRejected) {
        return { reason: "AXLE_LIMIT", detail: `${cargo.name} would overload an axle group.` }
      }
      if (stackRejected) {
        return { reason: "STACK_RULE", detail: `${cargo.name} has nowhere stable to sit.` }
      }
      return { reason: "NO_SPACE", detail: `No free space left for ${cargo.name}.` }
    }

    const placed: Placed = {
      ...best.box,
      instance,
      rotation: best.dims.rotation,
      layer: best.layer,
      loadAbove: 0,
      supporters: best.supporters,
      sequence: this.placed.length + 1,
    }
    this.placed.push(placed)
    this.netKg += cargo.weightKg
    if (cargo.segregationClass) this.classes.add(cargo.segregationClass)
    this.propagateLoad(placed, cargo.weightKg)
    this.splitSpaces(best.box)
    return null
  }

  placements(unitIndex: number): Placement[] {
    return this.placed.map((item) => ({
      cargoId: item.instance.cargo.id,
      instanceIndex: item.instance.instanceIndex,
      unitIndex,
      sequence: item.sequence,
      x: round(item.x),
      y: round(item.y),
      z: round(item.z),
      lengthCm: item.l,
      widthCm: item.w,
      heightCm: item.h,
      rotation: item.rotation,
      layer: item.layer,
    }))
  }

  metrics(): UnitMetrics {
    return computeUnitMetrics(this.equipment, this.metricBoxes())
  }

  /** The placed pieces as the shared metrics see them. */
  metricBoxes() {
    return this.placed.map((item) => ({
      id: `${item.instance.cargo.id}-${item.instance.instanceIndex}`,
      x: item.x,
      y: item.y,
      z: item.z,
      l: item.l,
      w: item.w,
      h: item.h,
      kg: item.instance.cargo.weightKg,
    }))
  }

  private conflicts(cls: string): boolean {
    for (const [a, b] of this.settings.segregation) {
      if (a === cls && this.classes.has(b)) return true
      if (b === cls && this.classes.has(a)) return true
    }
    return false
  }

  private supportFor(box: Box, cargo: SolverCargo): { supporters: Placed[]; layer: number } | null {
    if (box.z <= EPS) return { supporters: [], layer: 1 }
    const footprint = box.l * box.w
    let supportedArea = 0
    let layer = 1
    const supporters: Placed[] = []
    for (const below of this.placed) {
      if (Math.abs(below.z + below.h - box.z) > 0.5) continue
      const area = overlapArea(below, box)
      if (area <= EPS) continue
      if (!below.instance.cargo.stackable) return null
      if (this.settings.heavierBelow && cargo.weightKg > below.instance.cargo.weightKg + EPS) return null
      const share = (area / footprint) * cargo.weightKg
      if (!this.canCarry(below, share)) return null
      supporters.push(below)
      supportedArea += area
      layer = Math.max(layer, below.layer + 1)
    }
    if (supportedArea / footprint + EPS < this.settings.minSupportRatio) return null
    return { supporters, layer }
  }

  private canCarry(item: Placed, extraKg: number): boolean {
    const limit = item.instance.cargo.maxStackLoadKg
    if (limit !== null && item.loadAbove + extraKg > limit + EPS) return false
    if (item.supporters.length === 0) return true
    const total = item.supporters.reduce((sum, support) => sum + overlapArea(support, item), 0)
    if (total <= EPS) return true
    for (const support of item.supporters) {
      const share = (overlapArea(support, item) / total) * extraKg
      if (!this.canCarry(support, share)) return false
    }
    return true
  }

  private propagateLoad(item: Placed, kg: number) {
    if (item.supporters.length === 0) return
    const footprint = item.l * item.w
    for (const support of item.supporters) {
      const share = (overlapArea(support, item) / footprint) * kg
      support.loadAbove += share
      this.propagateLoad(support, share)
    }
  }

  private axlesOk(box: Box, kg: number): boolean {
    if (this.equipment.axleGroups.length === 0) return true
    const points = this.placed.map((item) => ({ x: item.x + item.l / 2, kg: item.instance.cargo.weightKg }))
    points.push({ x: box.x + box.l / 2, kg })
    let total = 0
    let moment = 0
    for (const point of points) {
      total += point.kg
      moment += point.kg * point.x
    }
    const loads = axleLoads(this.equipment.axleGroups, total, total > 0 ? moment / total : 0)
    return axleViolation(loads) === null
  }

  private splitSpaces(box: Box) {
    const next: Box[] = []
    for (const space of this.spaces) {
      if (!intersects(space, box)) {
        next.push(space)
        continue
      }
      const left = box.x - space.x
      if (left > EPS) next.push({ ...space, l: left })
      const right = space.x + space.l - (box.x + box.l)
      if (right > EPS) next.push({ ...space, x: box.x + box.l, l: right })
      const near = box.y - space.y
      if (near > EPS) next.push({ ...space, w: near })
      const far = space.y + space.w - (box.y + box.w)
      if (far > EPS) next.push({ ...space, y: box.y + box.w, w: far })
      const below = box.z - space.z
      if (below > EPS) next.push({ ...space, h: below })
      const above = space.z + space.h - (box.z + box.h)
      if (above > EPS) next.push({ ...space, z: box.z + box.h, h: above })
    }
    const pruned = next.filter((space) => space.l > 0.5 && space.w > 0.5 && space.h > 0.5)
    pruned.sort((a, b) => volume(b) - volume(a))
    const kept: Box[] = []
    for (const space of pruned) {
      if (kept.some((other) => contains(other, space))) continue
      kept.push(space)
    }
    this.spaces = kept.length > 1500 ? kept.slice(0, 1500) : kept
  }
}

function compareSpaces(a: Box, b: Box): number {
  if (Math.abs(a.z - b.z) > EPS) return a.z - b.z
  if (Math.abs(a.x - b.x) > EPS) return a.x - b.x
  return a.y - b.y
}

export function fitsAnywhereEmpty(equipment: SolverEquipment, dims: Dims[]): boolean {
  const empty: Box = { x: 0, y: 0, z: 0, l: equipment.lengthCm, w: equipment.widthCm, h: equipment.heightCm }
  return dims.some((dim) => snapBoxToContour(empty, dim, equipment) !== null)
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
