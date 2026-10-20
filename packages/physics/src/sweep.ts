import { bodyAabb } from "./aabb"
import { FINE_EPS, add3, dot3, scale3, type Vec3 } from "./math"
import { blockedByOthers, movedBody, worldCollision } from "./world"
import type { Aabb, PhysicsBody, PhysicsWorld } from "./types"

export type SweepHit = {
  body: PhysicsBody
  traveled: Vec3
  hit: boolean
  normal: Vec3 | null
}

/**
 * Swept move with slide-along-surface. Binary-searches the first contact,
 * then removes the remaining motion along the collision normal (max two slides).
 */
export function sweepMove(
  body: PhysicsBody,
  delta: Vec3,
  others: PhysicsBody[],
  world: PhysicsWorld,
): SweepHit {
  const first = sweepOnce(body, delta, others, world)
  if (!first.hit || !first.normal) return first
  const remaining = add3(delta, scale3(first.traveled, -1))
  const slide = add3(remaining, scale3(first.normal, -dot3(remaining, first.normal)))
  if (Math.hypot(slide.x, slide.y, slide.z) < FINE_EPS) return first
  const second = sweepOnce(first.body, slide, others, world)
  return {
    body: second.body,
    traveled: add3(first.traveled, second.traveled),
    hit: true,
    normal: second.normal ?? first.normal,
  }
}

function sweepOnce(
  body: PhysicsBody,
  delta: Vec3,
  others: PhysicsBody[],
  world: PhysicsWorld,
): SweepHit {
  if (Math.hypot(delta.x, delta.y, delta.z) < FINE_EPS) {
    return { body, traveled: { x: 0, y: 0, z: 0 }, hit: false, normal: null }
  }
  let lo = 0
  let hi = 1
  let lastGood = body
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2
    const trial = movedBody(body, scale3(delta, mid))
    if (invalid(trial, others, world)) hi = mid
    else {
      lo = mid
      lastGood = trial
    }
  }
  const hit = hi < 1 - 1e-4
  const traveled = scale3(delta, lo)
  return {
    body: lastGood,
    traveled,
    hit,
    normal: hit ? contactNormal(lastGood, others, world, delta) : null,
  }
}

function invalid(body: PhysicsBody, others: PhysicsBody[], world: PhysicsWorld): boolean {
  return worldCollision(body, world) !== null || blockedByOthers(body, others) !== null
}

function contactNormal(body: PhysicsBody, others: PhysicsBody[], world: PhysicsWorld, delta: Vec3): Vec3 {
  const wall = worldCollision(movedBody(body, scale3(delta, 1e-3)), world)
  if (wall) return wall
  const other = blockedByOthers(movedBody(body, scale3(delta, 1e-3)), others)
  if (!other) {
    if (Math.abs(delta.x) >= Math.abs(delta.y) && Math.abs(delta.x) >= Math.abs(delta.z)) {
      return { x: -Math.sign(delta.x) || -1, y: 0, z: 0 }
    }
    if (Math.abs(delta.y) >= Math.abs(delta.z)) return { x: 0, y: -Math.sign(delta.y) || -1, z: 0 }
    return { x: 0, y: 0, z: -Math.sign(delta.z) || -1 }
  }
  return aabbNormal(bodyAabb(body), bodyAabb(other))
}

function aabbNormal(a: Aabb, b: Aabb): Vec3 {
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)
  const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)
  if (overlapX <= overlapY && overlapX <= overlapZ) {
    return { x: a.min.x + a.max.x < b.min.x + b.max.x ? -1 : 1, y: 0, z: 0 }
  }
  if (overlapY <= overlapZ) {
    return { x: 0, y: a.min.y + a.max.y < b.min.y + b.max.y ? -1 : 1, z: 0 }
  }
  return { x: 0, y: 0, z: a.min.z + a.max.z < b.min.z + b.max.z ? -1 : 1 }
}
