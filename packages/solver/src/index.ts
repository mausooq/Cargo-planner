/**
 * Pure load-planning solver. No UI imports.
 */
export { solve, DEFAULT_SETTINGS } from "./solve"
export { boxFitsContour, snapBoxToContour } from "./contour"
export { orientationsFor } from "./geometry"
export { axleLoads, centreOfGravity, equipmentVolumeM3 } from "./metrics"
export { createRng } from "./rng"
export { computeUnitMetrics, layoutWarnings, lateralLimitCm, HIGH_COG_PCT, axleGroupsFromLoads } from "./unit-metrics"
export type { MetricBox, MetricUnit } from "./unit-metrics"
export {
  analyseRemainingCapacity,
  checkAdditionalFit,
  detectUniformCargo,
  disjointBoxes,
  subtractBox,
  DEFAULT_CAPACITY_LIMITS,
} from "./capacity"
export type {
  CapacityAnalysis,
  CapacityLimits,
  CapacityOptions,
  CapacityUnitInput,
  ExistingPiece,
  FitCheck,
  FitUnitResult,
  LimitingFactor,
  ProposedPlacement,
  RegionBase,
  SpaceRegion,
  StopInfo,
  UniformCheck,
  UnitAddition,
  UnitSpace,
} from "./capacity"
export type { PreloadProblem, PreloadProblemCode } from "./unit"
export type * from "./types"

export const SOLVER_VERSION = "1.0.0"
