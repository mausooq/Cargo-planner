import { bodiesOverlap, cylinderRadius } from "./collision"
import { bodyInsideContainer } from "./inside"
import { clamp, type Vec3 } from "./math"
import { settleHeight } from "./settle"
import { supportFrom } from "./support"
import { DEFAULT_WORLD, type PhysicsBody, type PhysicsWorld } from "./types"

export type DropReason =
  | "OK"
  | "OUTSIDE_CONTAINER"
  | "COLLISION"
  | "NO_SUPPORT"
  | "UNSTABLE"
  | "OVERLOAD_BELOW"
  | "NOT_STACKABLE"
  | "BOTTOM_ONLY"
  | "ORIENTATION_NOT_ALLOWED"
  | "WEIGHT_LIMIT"
  | "RULE_VIOLATION"

export type PhysicsSettings = {
  minSupportRatio: number
  maxOverhangRatio: number
  toleranceCm: number
  clampToWalls: boolean
  strictMode: boolean
  blockOnWeightLimit: boolean
  maxPayloadKg: number | null
}

export const DEFAULT_PHYSICS_SETTINGS: PhysicsSettings = {
  minSupportRatio: 0.7,
  maxOverhangRatio: 0.3,
  toleranceCm: 0.1,
  clampToWalls: false,
  strictMode: true,
  blockOnWeightLimit: true,
  maxPayloadKg: null,
}

export type DropPiece = PhysicsBody & {
  name?: string
  stackable?: boolean
  bottomOnly?: boolean
  maxStackLoadKg?: number | null
  maxLayers?: number | null
}

export type DropResult = {
  valid: boolean
  reason: DropReason
  message: string
  position: Vec3
  supportId?: string
  details?: Record<string, number>
}

export function validateDrop(
  unit: PhysicsWorld,
  pieces: DropPiece[],
  moving: DropPiece,
  desiredPosition: Vec3,
  settings: Partial<PhysicsSettings> = {},
): DropResult {
  const options = { ...DEFAULT_PHYSICS_SETTINGS, ...settings }
  const world: PhysicsWorld = {
    ...DEFAULT_WORLD,
    ...unit,
    minSupportRatio: options.minSupportRatio,
    maxOverhangRatio: options.maxOverhangRatio,
    toleranceCm: options.toleranceCm,
  }
  const others = pieces.filter((piece) => piece.id !== moving.id)
  let candidate = placeAt(moving, desiredPosition)
  if (options.clampToWalls) candidate = clampInside(candidate, world)

  if (!bodyInsideContainer(candidate, world)) {
    return fail("OUTSIDE_CONTAINER", "Outside container", candidate)
  }

  const supportZ = settleHeight(candidate, others, world)
  const settled = { ...candidate, cz: supportZ + candidate.hz }
  const position = { x: settled.cx - settled.hx, y: settled.cy - settled.hy, z: settled.cz - settled.hz }

  if (!bodyInsideContainer(settled, world)) {
    return fail("OUTSIDE_CONTAINER", "Outside container", settled, { roofCm: world.heightCm })
  }

  const hit = others.find((other) => bodiesOverlap(settled, other, options.toleranceCm))
  if (hit) {
    return {
      valid: false,
      reason: "COLLISION",
      message: `Collides with ${hit.name ?? "another piece"}`,
      position,
      details: { penetrationCm: options.toleranceCm },
    }
  }

  const support = supportFrom(settled, others, world)
  const onFloor = Math.abs(settled.cz - settled.hz - (world.decksCm[0] ?? 0)) <= world.toleranceCm + 0.1
  if (moving.bottomOnly && !onFloor) {
    return fail("BOTTOM_ONLY", `${moving.name ?? "This piece"} must sit on the floor`, settled)
  }
  if (!onFloor && support.areaRatio + 1e-9 < options.minSupportRatio) {
    return {
      valid: false,
      reason: "NO_SUPPORT",
      message: `Not enough support: ${Math.round(support.areaRatio * 100)}% < ${Math.round(options.minSupportRatio * 100)}%`,
      position,
      details: { supportPct: support.areaRatio * 100, minPct: options.minSupportRatio * 100 },
    }
  }
  if (!onFloor && !support.cogInside) {
    return fail("UNSTABLE", "Unstable: centre of gravity is off the support", settled)
  }

  const below = others.find((other) => {
    const gap = settled.cz - settled.hz - (other.cz + other.hz)
    return Math.abs(gap) <= world.toleranceCm + 0.1 && support.areaCm2 > 0
  })
  if (below && below.stackable === false) {
    return fail("NOT_STACKABLE", `${below.name ?? "Piece below"} is not stackable`, settled, undefined, below.id)
  }
  if (below && below.maxStackLoadKg != null && moving.massKg > below.maxStackLoadKg) {
    return {
      valid: false,
      reason: "OVERLOAD_BELOW",
      message: `Too heavy for piece below: ${moving.massKg} kg > ${below.maxStackLoadKg} kg`,
      position,
      supportId: below.id,
      details: { loadKg: moving.massKg, limitKg: below.maxStackLoadKg },
    }
  }

  if (options.maxPayloadKg != null) {
    const total = others.reduce((sum, piece) => sum + piece.massKg, 0) + moving.massKg
    if (total > options.maxPayloadKg + 1e-6) {
      const result = {
        valid: !options.blockOnWeightLimit,
        reason: "WEIGHT_LIMIT" as const,
        message: `Payload ${Math.round(total)} kg exceeds ${options.maxPayloadKg} kg`,
        position,
        details: { totalKg: total, limitKg: options.maxPayloadKg },
      }
      if (options.strictMode && options.blockOnWeightLimit) return { ...result, valid: false }
      if (!options.strictMode) return { ...result, valid: true }
      return result
    }
  }

  return {
    valid: true,
    reason: "OK",
    message: "OK",
    position,
    supportId: below?.id,
  }
}

function placeAt(body: DropPiece, minCorner: Vec3): DropPiece {
  return {
    ...body,
    cx: minCorner.x + body.hx,
    cy: minCorner.y + body.hy,
    cz: minCorner.z + body.hz,
  }
}

function clampInside(body: DropPiece, world: PhysicsWorld): DropPiece {
  const next = { ...body }
  if (next.shape === "cylinder" && next.cylinderAxis === "z") {
    const radius = cylinderRadius(next)
    next.cx = clamp(next.cx, radius, world.lengthCm - radius)
    next.cy = clamp(next.cy, radius, world.widthCm - radius)
    next.cz = clamp(next.cz, next.hz, world.heightCm - next.hz)
    return next
  }
  if (next.shape === "cylinder" && next.cylinderAxis === "x") {
    const radius = cylinderRadius(next)
    next.cx = clamp(next.cx, next.hx, world.lengthCm - next.hx)
    next.cy = clamp(next.cy, radius, world.widthCm - radius)
    next.cz = clamp(next.cz, radius, world.heightCm - radius)
    return next
  }
  if (next.shape === "cylinder" && next.cylinderAxis === "y") {
    const radius = cylinderRadius(next)
    next.cx = clamp(next.cx, radius, world.lengthCm - radius)
    next.cy = clamp(next.cy, next.hy, world.widthCm - next.hy)
    next.cz = clamp(next.cz, radius, world.heightCm - radius)
    return next
  }
  next.cx = clamp(next.cx, next.hx, world.lengthCm - next.hx)
  next.cy = clamp(next.cy, next.hy, world.widthCm - next.hy)
  next.cz = clamp(next.cz, next.hz, world.heightCm - next.hz)
  return next
}

function fail(
  reason: Exclude<DropReason, "OK">,
  message: string,
  body: PhysicsBody,
  details?: Record<string, number>,
  supportId?: string,
): DropResult {
  return {
    valid: false,
    reason,
    message,
    position: { x: body.cx - body.hx, y: body.cy - body.hy, z: body.cz - body.hz },
    supportId,
    details,
  }
}
