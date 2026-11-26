import { floorUtilization } from "@compass/physics"
import { hasSolverContour } from "./contour"
import { EPS, intersects, orientationsFor, overlapArea, volume, type Box } from "./geometry"
import { DEFAULT_SETTINGS } from "./solve"
import type { SolverCargo, SolverEquipment, SolverSettings, UnitMetrics, UnloadedReason } from "./types"
import { computeUnitMetrics, layoutWarnings } from "./unit-metrics"
import { Unit, type PreloadProblem } from "./unit"

/*
 * Remaining capacity of an existing load plan. Nothing here moves, removes or re-packs a piece of the
 * plan: each unit is rebuilt with its pieces exactly where they are (`Unit.preload`), and anything new is
 * tried around them with the packer's own `tryPlace`, so the same rules decide (rotations, walls and ULD
 * contour, collisions, support share, stacking, floor-only, stack limits, payload and axle loads).
 *
 * The packer is a greedy heuristic, so an additional count is a count that was FOUND to fit, never a
 * proven maximum. Work is bounded by a piece limit and a time budget, and the result says which one,
 * if any, stopped it, apart from the physical limits the packer reports.
 */

/** A piece of the existing plan: position of its minimum corner and its size as placed, in cm. */
export type ExistingPiece = {
  id: string
  cargoId: string
  x: number
  y: number
  z: number
  lengthCm: number
  widthCm: number
  heightCm: number
  rotation?: string
  /** Weight of this piece; used only when its cargo line is not known. */
  weightKg?: number
}

export type CapacityUnitInput = { unitIndex: number; equipment: SolverEquipment; pieces: ExistingPiece[] }

export type CapacityLimits = {
  /** Most pieces tried per unit. */
  maxPiecesPerUnit: number
  /** Time for the whole analysis, shared equally between units, in ms. */
  timeBudgetMs: number
  /** Most free spaces turned into reported regions per unit (largest first). */
  maxSpaces: number
  /** A free space narrower, shorter or lower than this (cm) is not counted as loading space. */
  minRegionCm: number
}

export const DEFAULT_CAPACITY_LIMITS: CapacityLimits = { maxPiecesPerUnit: 2000, timeBudgetMs: 3000, maxSpaces: 300, minRegionCm: 10 }

export type CapacityOptions = {
  settings?: Partial<SolverSettings>
  limits?: Partial<CapacityLimits>
  /** Clock in ms; tests replace it to prove the time limit. */
  now?: () => number
}

export type RegionBase = "floor" | "stackable-cargo" | "non-stackable-cargo"

/** An empty box of space. Regions in one list never overlap. */
export type SpaceRegion = {
  x: number
  y: number
  z: number
  lengthCm: number
  widthCm: number
  heightCm: number
  volumeM3: number
  /** What it stands on. Above non-stackable cargo it is restricted: nothing may go there. */
  base: RegionBase
  /** The cargo lines it stands on (empty on the floor). */
  baseCargoIds: string[]
}

export type UnitSpace = {
  unitIndex: number
  equipmentId: string
  equipmentName: string
  pieces: number
  payloadKg: number
  usedKg: number
  remainingKg: number
  capacityM3: number
  usedM3: number
  /** Inner volume less the cargo's own volume. Not all of it can take cargo. */
  theoreticalRemainingM3: number
  /** Free space with something to stand on (the floor, or stackable cargo) and room for a piece at least `minRegionCm` each way. */
  usableM3: number
  /** Free space above cargo that may not be stacked on. */
  restrictedM3: number
  /** The rest: gaps too small to load, space over air, and what the region limit left out. */
  otherUnusableM3: number
  floorAreaM2: number
  usedFloorM2: number
  remainingFloorM2: number
  /** Floor area of the usable regions that stand on the floor. */
  usableFloorM2: number
  /** Height free above the tallest piece. */
  headroomCm: number
  /** Usable regions, largest first. */
  regions: SpaceRegion[]
  /** Regions above cargo that may not be stacked on. */
  restrictedRegions: SpaceRegion[]
  /** True when the region limit was reached; the usable volume is then a lower figure. */
  regionsTruncated: boolean
  /** A ULD with cut corners or a sloped roof: regions are boxes and may reach into the cut-outs. */
  contoured: boolean
  problems: PreloadProblem[]
}

export type LimitingFactor = "space" | "payload" | "stacking" | "axle" | "size" | "segregation" | "equipment"

/** Why adding stopped. `physical`: the packer refused the next piece. The other kinds are the simulation's own bounds. */
export type StopInfo =
  | { kind: "physical"; factor: LimitingFactor; reason: UnloadedReason; message: string }
  | { kind: "time-limit"; message: string }
  | { kind: "iteration-limit"; message: string }
  | { kind: "complete"; message: string }

export type ProposedPlacement = { unitIndex: number; x: number; y: number; z: number; lengthCm: number; widthCm: number; heightCm: number; rotation: string; weightKg: number }

export type UnitAddition = {
  unitIndex: number
  pieces: number
  weightKg: number
  volumeM3: number
  placements: ProposedPlacement[]
  stop: StopInfo
  /** The unit's figures with the proposed pieces in it. */
  metricsAfter: UnitMetrics
  /** Balance and limit warnings that the proposed pieces would add. */
  newWarnings: string[]
}

export type UniformCheck =
  | {
      uniform: true
      /** The piece that would be added: the loaded pieces' size and rules, and the heaviest of their weights. */
      template: SolverCargo
      cargoIds: string[]
      /** Pieces in the plan (quantities counted, not cargo lines). */
      loadedPieces: number
      weightsDiffer: boolean
    }
  | { uniform: false; loadedPieces: number; reason: string }

export type CapacityAnalysis = {
  units: UnitSpace[]
  uniform: UniformCheck
  /** Only when the cargo is uniform. */
  additional: {
    units: UnitAddition[]
    pieces: number
    weightKg: number
    volumeM3: number
    potentialTotalPieces: number
    /** True when every unit stopped on a physical limit. Even then it is the count found, not a proven maximum. */
    searchComplete: boolean
  } | null
  /** No rule violations in the existing plan. When false, nothing added to it is validated. */
  validated: boolean
  violations: PreloadProblem[]
  notes: PreloadProblem[]
  totals: {
    remainingKg: number
    theoreticalRemainingM3: number
    usableM3: number
    restrictedM3: number
    otherUnusableM3: number
    remainingFloorM2: number
    usableFloorM2: number
  }
}

export type FitUnitResult = { unitIndex: number; pieces: number; placements: ProposedPlacement[]; stop: StopInfo; metricsAfter: UnitMetrics; newWarnings: string[] }

export type FitCheck = {
  requested: number
  placed: number
  notPlaced: number
  allFit: boolean
  units: FitUnitResult[]
  /** Why the remaining pieces were not placed, from the last unit tried. */
  stop: StopInfo
  validated: boolean
  violations: PreloadProblem[]
}

const M3 = 1_000_000
const M2 = 10_000
const round = (value: number, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const FACTOR: Record<UnloadedReason, LimitingFactor> = {
  NO_SPACE: "space",
  TOO_HEAVY: "payload",
  AXLE_LIMIT: "axle",
  STACK_RULE: "stacking",
  ORIENTATION: "space",
  OUT_OF_GAUGE: "size",
  SEGREGATION: "segregation",
  EQUIPMENT_RESTRICTION: "equipment",
}

const FACTOR_TEXT: Record<LimitingFactor, string> = {
  space: "no free space is large enough",
  payload: "the payload limit is reached",
  stacking: "the remaining space has nothing it may stand on (stacking or support rules)",
  axle: "an axle group would be overloaded",
  size: "the piece does not fit this unit in any allowed orientation",
  segregation: "segregation rules forbid it",
  equipment: "the equipment does not allow it",
}

function settingsOf(options: CapacityOptions): SolverSettings {
  const given = Object.fromEntries(Object.entries(options.settings ?? {}).filter(([, value]) => value !== undefined))
  return { ...DEFAULT_SETTINGS, ...given }
}

function limitsOf(options: CapacityOptions): CapacityLimits {
  return { ...DEFAULT_CAPACITY_LIMITS, ...Object.fromEntries(Object.entries(options.limits ?? {}).filter(([, value]) => value !== undefined)) }
}

function clock(options: CapacityOptions): () => number {
  return options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()))
}

/** A unit rebuilt with the plan's pieces where they are. Inputs are copied, never changed. */
function rebuild(input: CapacityUnitInput, cargoById: Map<string, SolverCargo>, settings: SolverSettings): { unit: Unit; problems: PreloadProblem[] } {
  const unit = new Unit(input.equipment, settings)
  const missing: PreloadProblem[] = []
  const problems = unit.preload(
    input.pieces.map((piece, index) => {
      let cargo = cargoById.get(piece.cargoId)
      if (!cargo) {
        // A piece whose cargo line is gone: kept in place, treated as not stackable, and reported.
        cargo = unknownCargo(piece)
        missing.push({ pieceId: piece.id, code: "UNKNOWN_CARGO", severity: "violation", message: "A piece in the plan has no cargo line any more. Recalculate the plan." })
      }
      return {
        id: piece.id,
        instance: { cargo, instanceIndex: index },
        box: { x: piece.x, y: piece.y, z: piece.z, l: piece.lengthCm, w: piece.widthCm, h: piece.heightCm },
        rotation: piece.rotation ?? "LWH",
      }
    }),
  )
  return { unit, problems: [...missing, ...problems] }
}

function unknownCargo(piece: ExistingPiece): SolverCargo {
  return {
    id: piece.cargoId,
    name: "Unknown piece",
    lengthCm: piece.lengthCm,
    widthCm: piece.widthCm,
    heightCm: piece.heightCm,
    weightKg: piece.weightKg ?? 0,
    quantity: 1,
    shape: "BOX",
    orientation: "FIXED",
    stackable: false,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
  }
}

// ---- free space -----------------------------------------------------------------------------------------------

/** `a` less `b`, as up to six boxes that do not overlap each other or `b`. */
export function subtractBox(a: Box, b: Box): Box[] {
  if (!intersects(a, b)) return [a]
  const out: Box[] = []
  const x0 = Math.max(a.x, b.x)
  const x1 = Math.min(a.x + a.l, b.x + b.l)
  const y0 = Math.max(a.y, b.y)
  const y1 = Math.min(a.y + a.w, b.y + b.w)
  const z0 = Math.max(a.z, b.z)
  const z1 = Math.min(a.z + a.h, b.z + b.h)
  if (x0 > a.x + EPS) out.push({ ...a, l: x0 - a.x })
  if (a.x + a.l > x1 + EPS) out.push({ ...a, x: x1, l: a.x + a.l - x1 })
  const midX = { x: x0, l: x1 - x0 }
  if (y0 > a.y + EPS) out.push({ ...a, ...midX, w: y0 - a.y })
  if (a.y + a.w > y1 + EPS) out.push({ ...a, ...midX, y: y1, w: a.y + a.w - y1 })
  const midXY = { ...midX, y: y0, w: y1 - y0 }
  if (z0 > a.z + EPS) out.push({ ...a, ...midXY, h: z0 - a.z })
  if (a.z + a.h > z1 + EPS) out.push({ ...a, ...midXY, z: z1, h: a.z + a.h - z1 })
  return out.filter((box) => box.l > 0.05 && box.w > 0.05 && box.h > 0.05)
}

/**
 * The union of possibly overlapping boxes as boxes that do not overlap, largest boxes kept whole first.
 * Used for reporting only, so no volume is counted twice; the packer itself keeps using the overlapping
 * maximal spaces, so no larger placement opportunity is lost. `taken` is space already accounted for.
 */
export function disjointBoxes(boxes: Box[], taken: Box[] = [], maxPieces = 4000): { boxes: Box[]; truncated: boolean } {
  const out: Box[] = []
  const blockers = taken.slice()
  let truncated = false
  for (const box of boxes.slice().sort((a, b) => volume(b) - volume(a))) {
    let pieces = [box]
    for (const blocker of blockers) {
      if (pieces.length === 0) break
      pieces = pieces.flatMap((piece) => subtractBox(piece, blocker))
    }
    if (out.length + pieces.length > maxPieces) {
      truncated = true
      break
    }
    out.push(...pieces)
    blockers.push(...pieces)
  }
  return { boxes: out, truncated }
}

type Tagged = Box & { base: RegionBase; baseCargoIds: string[] }

/** Splits the packer's free spaces by what they stand on. */
function classifySpaces(unit: Unit, limits: CapacityLimits): { usable: Tagged[]; restricted: Tagged[] } {
  const usable: Tagged[] = []
  const restricted: Tagged[] = []
  const big = (box: Box) => box.l >= limits.minRegionCm - EPS && box.w >= limits.minRegionCm - EPS && box.h >= limits.minRegionCm - EPS
  const spaces = unit
    .freeSpaces()
    .sort((a, b) => volume(b) - volume(a))
    .slice(0, limits.maxSpaces)
  for (const space of spaces) {
    if (space.z <= 0.5) {
      if (big(space)) usable.push({ ...space, base: "floor", baseCargoIds: [] })
      continue
    }
    // Above cargo, only the part over a piece whose top is at this height has anything to stand on.
    for (const below of unit.placed) {
      if (Math.abs(below.z + below.h - space.z) > 0.5 || overlapArea(below, space) <= EPS) continue
      const x0 = Math.max(space.x, below.x)
      const y0 = Math.max(space.y, below.y)
      const part: Box = { x: x0, y: y0, z: space.z, l: Math.min(space.x + space.l, below.x + below.l) - x0, w: Math.min(space.y + space.w, below.y + below.w) - y0, h: space.h }
      const cargo = below.instance.cargo
      if (cargo.stackable) {
        if (big(part)) usable.push({ ...part, base: "stackable-cargo", baseCargoIds: [cargo.id] })
      } else {
        restricted.push({ ...part, base: "non-stackable-cargo", baseCargoIds: [cargo.id] })
      }
    }
  }
  return { usable, restricted }
}

function toRegions(boxes: Box[], tagged: Tagged[]): SpaceRegion[] {
  return boxes
    .map((box) => {
      // A disjoint piece came from one tagged space; find which, for its base.
      const source = tagged.find((entry) => box.x >= entry.x - EPS && box.y >= entry.y - EPS && box.z >= entry.z - EPS && box.x + box.l <= entry.x + entry.l + EPS && box.y + box.w <= entry.y + entry.w + EPS && box.z + box.h <= entry.z + entry.h + EPS)
      return {
        x: round(box.x, 1),
        y: round(box.y, 1),
        z: round(box.z, 1),
        lengthCm: round(box.l, 1),
        widthCm: round(box.w, 1),
        heightCm: round(box.h, 1),
        volumeM3: round(volume(box) / M3),
        base: source?.base ?? "floor",
        baseCargoIds: source?.baseCargoIds ?? [],
      }
    })
    .sort((a, b) => b.volumeM3 - a.volumeM3)
}

function unitSpace(input: CapacityUnitInput, unit: Unit, problems: PreloadProblem[], limits: CapacityLimits): UnitSpace {
  const equipment = input.equipment
  const boxes = unit.metricBoxes()
  const metrics = computeUnitMetrics(equipment, boxes)
  const capacity = equipment.lengthCm * equipment.widthCm * equipment.heightCm
  const used = boxes.reduce((sum, box) => sum + box.l * box.w * box.h, 0)
  const theoretical = Math.max(0, capacity - used)
  const { usable, restricted } = classifySpaces(unit, limits)
  const usableBoxes = disjointBoxes(usable)
  const restrictedBoxes = disjointBoxes(restricted, usableBoxes.boxes)
  const usableVolume = usableBoxes.boxes.reduce((sum, box) => sum + volume(box), 0)
  const restrictedVolume = restrictedBoxes.boxes.reduce((sum, box) => sum + volume(box), 0)
  const floorArea = equipment.lengthCm * equipment.widthCm
  const usedFloor = floorUtilization(boxes, equipment).areaCm2
  const usableFloor = usableBoxes.boxes.filter((box) => box.z <= 0.5).reduce((sum, box) => sum + box.l * box.w, 0)
  return {
    unitIndex: input.unitIndex,
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    pieces: boxes.length,
    payloadKg: equipment.maxPayloadKg,
    usedKg: metrics.netKg,
    remainingKg: metrics.remainingKg,
    capacityM3: round(capacity / M3),
    usedM3: round(used / M3),
    theoreticalRemainingM3: round(theoretical / M3),
    usableM3: round(usableVolume / M3),
    restrictedM3: round(restrictedVolume / M3),
    otherUnusableM3: round(Math.max(0, theoretical - usableVolume - restrictedVolume) / M3),
    floorAreaM2: round(floorArea / M2),
    usedFloorM2: round(usedFloor / M2),
    remainingFloorM2: round(Math.max(0, floorArea - usedFloor) / M2),
    usableFloorM2: round(usableFloor / M2),
    headroomCm: round(Math.max(0, equipment.heightCm - metrics.usedHeightCm), 1),
    regions: toRegions(usableBoxes.boxes, usable),
    restrictedRegions: toRegions(restrictedBoxes.boxes, restricted),
    regionsTruncated: usableBoxes.truncated || restrictedBoxes.truncated || unit.freeSpaces().length > limits.maxSpaces,
    contoured: hasSolverContour(equipment.contour),
    problems,
  }
}

// ---- uniform cargo ----------------------------------------------------------------------------------------------

/** Two cargo lines are the same package when they can take the same placed sizes and follow the same rules. */
function packageKey(cargo: SolverCargo): string {
  const sizes = orientationsFor(cargo)
    .map((dim) => [dim.l, dim.w, dim.h].map((value) => Math.round(value * 10) / 10).join("x"))
    .sort()
  return JSON.stringify([cargo.shape, sizes, cargo.stackable, cargo.bottomOnly, cargo.maxStackLoadKg, cargo.maxStackLayers, cargo.segregationClass])
}

export function detectUniformCargo(units: CapacityUnitInput[], cargo: SolverCargo[]): UniformCheck {
  const byId = new Map(cargo.map((line) => [line.id, line]))
  const used = new Map<string, SolverCargo>()
  let loadedPieces = 0
  let unknown = false
  for (const unit of units) {
    for (const piece of unit.pieces) {
      loadedPieces += 1
      const line = byId.get(piece.cargoId)
      if (line) used.set(line.id, line)
      else unknown = true
    }
  }
  if (loadedPieces === 0) return { uniform: false, loadedPieces, reason: "The plan has no loaded cargo." }
  if (unknown) return { uniform: false, loadedPieces, reason: "Some pieces in the plan have no cargo line any more." }
  const lines = [...used.values()]
  const keys = new Set(lines.map(packageKey))
  if (keys.size > 1) return { uniform: false, loadedPieces, reason: "The loaded packages differ in size, shape, orientation or stacking rules." }
  const heaviest = lines.reduce((best, line) => (line.weightKg > best.weightKg ? line : best), lines[0]!)
  return {
    uniform: true,
    template: { ...heaviest, id: "__additional__", quantity: 1 },
    cargoIds: lines.map((line) => line.id),
    loadedPieces,
    weightsDiffer: new Set(lines.map((line) => line.weightKg)).size > 1,
  }
}

// ---- adding pieces ----------------------------------------------------------------------------------------------

function addPieces(unit: Unit, template: SolverCargo, count: number, deadline: number, now: () => number): StopInfo {
  for (let index = 0; ; index += 1) {
    if (index >= count) return { kind: "complete", message: "All pieces were placed." }
    if (now() > deadline) return { kind: "time-limit", message: "The time limit for the simulation was reached; more may fit." }
    const rejection = unit.tryPlace({ cargo: template, instanceIndex: index })
    if (rejection) {
      const factor = FACTOR[rejection.reason]
      return { kind: "physical", factor, reason: rejection.reason, message: `No more fit: ${FACTOR_TEXT[factor]}.` }
    }
  }
}

function addedPlacements(unit: Unit, from: number, unitIndex: number): ProposedPlacement[] {
  return unit.placed.slice(from).map((item) => ({
    unitIndex,
    x: round(item.x, 1),
    y: round(item.y, 1),
    z: round(item.z, 1),
    lengthCm: item.l,
    widthCm: item.w,
    heightCm: item.h,
    rotation: item.rotation,
    weightKg: item.instance.cargo.weightKg,
  }))
}

function afterFigures(input: CapacityUnitInput, unit: Unit, before: string[]): { metricsAfter: UnitMetrics; newWarnings: string[] } {
  const boxes = unit.metricBoxes()
  const metricsAfter = computeUnitMetrics(input.equipment, boxes)
  const newWarnings = layoutWarnings(input.equipment, boxes, metricsAfter).filter((warning) => !before.includes(warning))
  return { metricsAfter, newWarnings }
}

function warningsNow(input: CapacityUnitInput, unit: Unit): string[] {
  const boxes = unit.metricBoxes()
  return layoutWarnings(input.equipment, boxes, computeUnitMetrics(input.equipment, boxes))
}

/**
 * The remaining capacity of every unit of a plan, and, when every loaded package is the same, how many more
 * of it were found to fit and where. The inputs are not changed.
 */
export function analyseRemainingCapacity(units: CapacityUnitInput[], cargo: SolverCargo[], options: CapacityOptions = {}): CapacityAnalysis {
  const settings = settingsOf(options)
  const limits = limitsOf(options)
  const now = clock(options)
  const cargoById = new Map(cargo.map((line) => [line.id, line]))
  const uniform = detectUniformCargo(units, cargo)
  const started = now()
  const perUnit = units.length > 0 ? limits.timeBudgetMs / units.length : 0

  const spaces: UnitSpace[] = []
  const additions: UnitAddition[] = []
  units.forEach((input, position) => {
    const { unit, problems } = rebuild(input, cargoById, settings)
    spaces.push(unitSpace(input, unit, problems, limits))
    if (!uniform.uniform) return
    const before = warningsNow(input, unit)
    const from = unit.placed.length
    const startKg = unit.netKg
    const stop = addPieces(unit, uniform.template, limits.maxPiecesPerUnit, started + perUnit * (position + 1), now)
    const placements = addedPlacements(unit, from, input.unitIndex)
    additions.push({
      unitIndex: input.unitIndex,
      pieces: placements.length,
      weightKg: round(unit.netKg - startKg, 1),
      volumeM3: round(placements.reduce((sum, item) => sum + item.lengthCm * item.widthCm * item.heightCm, 0) / M3),
      placements,
      stop: stop.kind === "complete" ? { kind: "iteration-limit", message: `Stopped after ${limits.maxPiecesPerUnit} pieces, the limit for one unit; more may fit.` } : stop,
      ...afterFigures(input, unit, before),
    })
  })

  const all = spaces.flatMap((unit) => unit.problems)
  const violations = all.filter((problem) => problem.severity === "violation")
  const sum = (pick: (unit: UnitSpace) => number) => round(spaces.reduce((total, unit) => total + pick(unit), 0))
  const extra = additions.reduce((total, unit) => total + unit.pieces, 0)
  return {
    units: spaces,
    uniform,
    additional: uniform.uniform
      ? {
          units: additions,
          pieces: extra,
          weightKg: round(additions.reduce((total, unit) => total + unit.weightKg, 0), 1),
          volumeM3: round(additions.reduce((total, unit) => total + unit.volumeM3, 0)),
          potentialTotalPieces: uniform.loadedPieces + extra,
          searchComplete: additions.every((unit) => unit.stop.kind === "physical"),
        }
      : null,
    validated: violations.length === 0,
    violations,
    notes: all.filter((problem) => problem.severity === "note"),
    totals: {
      remainingKg: round(spaces.reduce((total, unit) => total + unit.remainingKg, 0), 1),
      theoreticalRemainingM3: sum((unit) => unit.theoreticalRemainingM3),
      usableM3: sum((unit) => unit.usableM3),
      restrictedM3: sum((unit) => unit.restrictedM3),
      otherUnusableM3: sum((unit) => unit.otherUnusableM3),
      remainingFloorM2: sum((unit) => unit.remainingFloorM2),
      usableFloorM2: sum((unit) => unit.usableFloorM2),
    },
  }
}

/**
 * Would `cargo` (its quantity in pieces) fit in the plan as it stands? Units are tried in order, each with the
 * plan's pieces where they are; what one unit cannot take is tried in the next. Nothing is kept.
 */
export function checkAdditionalFit(units: CapacityUnitInput[], planCargo: SolverCargo[], cargo: SolverCargo, options: CapacityOptions = {}): FitCheck {
  const settings = settingsOf(options)
  const limits = limitsOf(options)
  const now = clock(options)
  const cargoById = new Map(planCargo.map((line) => [line.id, line]))
  const requested = Math.max(0, Math.floor(cargo.quantity))
  const template: SolverCargo = { ...cargo, id: cargo.id || "__check__", quantity: 1 }
  const started = now()
  const perUnit = units.length > 0 ? limits.timeBudgetMs / units.length : 0
  let left = Math.min(requested, limits.maxPiecesPerUnit * Math.max(1, units.length))
  const results: FitUnitResult[] = []
  const problems: PreloadProblem[] = []
  let stop: StopInfo = units.length === 0 ? { kind: "physical", factor: "equipment", reason: "EQUIPMENT_RESTRICTION", message: "The plan has no units." } : { kind: "complete", message: "All pieces were placed." }

  units.forEach((input, position) => {
    const { unit, problems: found } = rebuild(input, cargoById, settings)
    problems.push(...found)
    if (left === 0) return
    const before = warningsNow(input, unit)
    const from = unit.placed.length
    const unitStop = addPieces(unit, template, Math.min(left, limits.maxPiecesPerUnit), started + perUnit * (position + 1), now)
    const placements = addedPlacements(unit, from, input.unitIndex)
    left -= placements.length
    stop = unitStop
    results.push({ unitIndex: input.unitIndex, pieces: placements.length, placements, stop: unitStop, ...afterFigures(input, unit, before) })
  })

  const placed = results.reduce((total, unit) => total + unit.pieces, 0)
  if (placed < requested && stop.kind === "complete") {
    stop = { kind: "iteration-limit", message: `Only ${limits.maxPiecesPerUnit} pieces per unit are simulated.` }
  }
  const violations = problems.filter((problem) => problem.severity === "violation")
  return { requested, placed, notPlaced: requested - placed, allFit: placed === requested, units: results, stop, validated: violations.length === 0, violations }
}
