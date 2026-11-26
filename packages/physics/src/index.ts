export { G_MPS2, EPS_CM, FINE_EPS } from "./math"
export type { Vec2, Vec3 } from "./math"
export {
  DEFAULT_WORLD,
  boxBody,
  cylinderBody,
  minCorner,
  bodyBottom,
  bodyTop,
} from "./types"
export type { PhysicsBody, PhysicsWorld, Aabb, BodyShape, CylinderAxis, ContactPatch } from "./types"
export {
  DEFAULT_MIN_SUPPORT_PCT,
  MIN_SUPPORT_PCT_RANGE,
  validMinSupportPct,
  resolveMinSupportPct,
  resolveMinSupportRatio,
} from "./support-policy"
export { bodyAabb, aabbOverlap, aabbVolume, aabbContains } from "./aabb"
export { bodiesOverlap, boxesOverlap, cylindersOverlap, cylinderBoxOverlap, cylinderRadius } from "./collision"
export { overlappingPairs } from "./broadphase"
export { convexHull, polygonArea, pointInPolygon } from "./hull"
export {
  footprintCorners,
  baseArea,
  contactWithFloor,
  contactWithBody,
  supportFrom,
  nearestDeck,
} from "./support"
export type { SupportResult } from "./support"
export { worldAabb, insideWorld, worldCollision, hitsObstruction, movedBody } from "./world"
export { sweepMove } from "./sweep"
export type { SweepHit } from "./sweep"
export { settleBodies, highestSupport, settleHeight, footprintOverlaps, footprintOverlapRatio, hasInterpenetration } from "./settle"
export { bodyInsideContainer } from "./inside"
export {
  validateDrop,
  DEFAULT_PHYSICS_SETTINGS,
} from "./validate-drop"
export type { DropReason, DropResult, DropPiece, PhysicsSettings } from "./validate-drop"
export { FLOOR_CONTACT_TOLERANCE_CM, isOnFloor, unionArea, floorUtilization } from "./footprint"
export type { PlanBox, FloorUnit, FloorUtilization } from "./footprint"
export { parseRotation, describeRotation, flatRotationCode, nextQuarterTurn, nextFlatRotation, allowsHalfTurn } from "./rotation"
export type { ParsedRotation } from "./rotation"
