import { bodyAabb } from "./aabb"
import { overlappingPairs } from "./broadphase"
import { bodiesOverlap } from "./collision"
import { EPS_CM } from "./math"
import { baseArea, nearestDeck } from "./support"
import type { PhysicsBody, PhysicsWorld } from "./types"

export type SettleResult = {
  bodies: PhysicsBody[]
  moved: boolean
}

/**
 * Analytic gravity settle: each piece falls along -Z onto the floor or the
 * highest supporting top under its footprint. Processed bottom-up.
 */
export function settleBodies(bodies: PhysicsBody[], world: PhysicsWorld): SettleResult {
  const ordered = bodies.slice().sort((a, b) => a.cz - a.hz - (b.cz - b.hz))
  const settled: PhysicsBody[] = []
  let moved = false
  for (const body of ordered) {
    const supportZ = highestSupport(body, settled, world)
    const nextCz = supportZ + body.hz
    if (Math.abs(nextCz - body.cz) > world.toleranceCm) moved = true
    settled.push({ ...body, cz: nextCz })
  }
  return { bodies: settled, moved }
}

export function highestSupport(body: PhysicsBody, below: PhysicsBody[], world: PhysicsWorld): number {
  const currentBottom = body.cz - body.hz
  let best = nearestDeck(body, world)
  for (const other of below) {
    if (other.id === body.id) continue
    if (!footprintOverlaps(body, other)) continue
    const top = other.cz + other.hz
    if (top <= currentBottom + world.toleranceCm && top > best) best = top
  }
  return best
}

export function footprintOverlaps(a: PhysicsBody, b: PhysicsBody): boolean {
  const aa = bodyAabb(a)
  const bb = bodyAabb(b)
  return (
    aa.min.x < bb.max.x - EPS_CM &&
    aa.max.x > bb.min.x + EPS_CM &&
    aa.min.y < bb.max.y - EPS_CM &&
    aa.max.y > bb.min.y + EPS_CM
  )
}

export function footprintOverlapRatio(a: PhysicsBody, b: PhysicsBody): number {
  const aa = bodyAabb(a)
  const bb = bodyAabb(b)
  const dx = Math.min(aa.max.x, bb.max.x) - Math.max(aa.min.x, bb.min.x)
  const dy = Math.min(aa.max.y, bb.max.y) - Math.max(aa.min.y, bb.min.y)
  const base = baseArea(a)
  if (dx <= EPS_CM || dy <= EPS_CM || base <= EPS_CM) return 0
  return (dx * dy) / base
}

/** Highest surface the body can land on, including pieces it currently overlaps. */
export function settleHeight(body: PhysicsBody, below: PhysicsBody[], world: PhysicsWorld, minOverlap = 0.3): number {
  let best = nearestDeck(body, world)
  for (const other of below) {
    if (other.id === body.id) continue
    if (footprintOverlapRatio(body, other) < minOverlap) continue
    best = Math.max(best, other.cz + other.hz)
  }
  return best
}

export function hasInterpenetration(bodies: PhysicsBody[], eps = EPS_CM): boolean {
  for (const [a, b] of overlappingPairs(bodies)) {
    if (bodiesOverlap(a, b, eps)) return true
  }
  return false
}
