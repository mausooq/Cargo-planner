/**
 * All lengths are centimetres, all weights kilograms.
 * x runs from the front bulkhead toward the doors, y across the width from the
 * left wall, z up from the floor.
 */

export type SolverOrientation = "FIXED" | "LONGSHIP" | "ROTATE_90" | "TILTABLE" | "ANY" | "CUSTOM"
export type SolverAxisRotation = "LWH" | "WLH" | "LHW" | "HLW" | "HWL" | "WHL"
export type SolverShape = "BOX" | "CYLINDER_DRUM" | "PIPE"
export type SolverObjective = "FEWEST_UNITS" | "LOWEST_COST"

export type SolverAxleGroup = {
  name: string
  positionFromFrontCm: number
  maxKg: number
}

export type SolverContourSide = {
  lengthCm: number
  heightCm: number
}

export type SolverContour = {
  bottomLeft: SolverContourSide
  bottomRight: SolverContourSide
  topLeft: SolverContourSide
  topRight: SolverContourSide
}

export type SolverEquipment = {
  id: string
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  maxPayloadKg: number
  tareKg: number
  axleGroups: SolverAxleGroup[]
  costPerUnit: number
  /** null means unlimited */
  maxCount: number | null
  /** Inner ULD cut. Cargo must stay inside this envelope. */
  contour?: SolverContour | null
}

export type SolverCargo = {
  id: string
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  quantity: number
  shape: SolverShape
  orientation: SolverOrientation
  /** Used when orientation is CUSTOM. */
  allowedRotations?: SolverAxisRotation[] | null
  /** Other cargo may be placed on top of this item. */
  stackable: boolean
  /** Must sit on the floor. */
  bottomOnly: boolean
  maxStackLoadKg: number | null
  maxStackLayers: number | null
  priority: number
  destinationStop: number
  consignmentId: string | null
  segregationClass: string | null
  color: string | null
}

export type SolverSettings = {
  seed: number
  /** Orderings tried. Deterministic for a given seed. */
  restarts: number
  /** Stops starting new restarts after this long. */
  timeLimitMs: number
  objective: SolverObjective
  /** Nothing heavier may sit on something lighter. */
  heavierBelow: boolean
  /** Fraction of an item's footprint that must rest on something. */
  minSupportRatio: number
  /** Order cargo so each consignment packs as a block. */
  keepConsignmentsTogether: boolean
  /** Pairs of segregation classes that may not share a unit. */
  segregation: [string, string][]
}

export type SolverInput = {
  equipment: SolverEquipment[]
  cargo: SolverCargo[]
  settings?: Partial<SolverSettings>
}

export type Placement = {
  cargoId: string
  instanceIndex: number
  unitIndex: number
  /** Loading order inside the unit, 1 based. */
  sequence: number
  x: number
  y: number
  z: number
  lengthCm: number
  widthCm: number
  heightCm: number
  /** Which cargo axes ended up along x, y, z. For example LWH or WLH. */
  rotation: string
  layer: number
}

export type AxleLoad = {
  name: string
  positionFromFrontCm: number
  kg: number
  maxKg: number
}

export type UnitMetrics = {
  netKg: number
  grossKg: number
  volumeM3: number
  volumePct: number
  floorPct: number
  weightPct: number
  usedLengthCm: number
  usedWidthCm: number
  usedHeightCm: number
  cog: { x: number; y: number; z: number }
  axleLoads: AxleLoad[]
  pieces: number
}

export type PlannedUnit = {
  unitIndex: number
  equipmentId: string
  placements: Placement[]
  metrics: UnitMetrics
}

export type UnloadedReason =
  | "NO_SPACE"
  | "TOO_HEAVY"
  | "AXLE_LIMIT"
  | "ORIENTATION"
  | "STACK_RULE"
  | "SEGREGATION"
  | "EQUIPMENT_RESTRICTION"
  | "OUT_OF_GAUGE"

export type UnloadedItem = {
  cargoId: string
  instanceIndex: number
  reason: UnloadedReason
  detail: string
}

export type SolverResult = {
  units: PlannedUnit[]
  unloaded: UnloadedItem[]
  warnings: string[]
  totalCost: number
  seed: number
  restartsRun: number
  elapsedMs: number
  settings: SolverSettings
}

export type SolverProgress = {
  restart: number
  restarts: number
  bestUnits: number
  bestUnloaded: number
}
