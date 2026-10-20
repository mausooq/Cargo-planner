import { bodyAabb } from "./aabb"
import type { Aabb, PhysicsBody } from "./types"

/** Sweep-and-prune on X, then filter Y/Z. Returns unique undirected pairs. */
export function overlappingPairs(bodies: PhysicsBody[]): [PhysicsBody, PhysicsBody][] {
  const entries = bodies
    .map((body) => ({ body, aabb: bodyAabb(body) }))
    .sort((a, b) => a.aabb.min.x - b.aabb.min.x)
  const pairs: [PhysicsBody, PhysicsBody][] = []
  for (let i = 0; i < entries.length; i += 1) {
    const left = entries[i]
    if (!left) continue
    for (let j = i + 1; j < entries.length; j += 1) {
      const right = entries[j]
      if (!right) continue
      if (right.aabb.min.x >= left.aabb.max.x) break
      if (intervalsOverlap(left.aabb, right.aabb)) pairs.push([left.body, right.body])
    }
  }
  return pairs
}

function intervalsOverlap(a: Aabb, b: Aabb): boolean {
  return a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z
}
