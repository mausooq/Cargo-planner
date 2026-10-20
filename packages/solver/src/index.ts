/**
 * Pure load-planning solver. No UI imports.
 */
export { solve, DEFAULT_SETTINGS } from "./solve"
export { boxFitsContour, snapBoxToContour } from "./contour"
export { orientationsFor } from "./geometry"
export { axleLoads, centreOfGravity, equipmentVolumeM3 } from "./metrics"
export { createRng } from "./rng"
export type * from "./types"

export const SOLVER_VERSION = "1.0.0"
