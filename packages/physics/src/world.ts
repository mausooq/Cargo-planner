import { bodyAabb } from "./aabb"
import { bodiesOverlap, cylinderRadius } from "./collision"
import { bodyInsideContainer } from "./inside"
import { EPS_CM, type Vec3 } from "./math"
import type { Aabb, PhysicsBody, PhysicsWorld } from "./types"

export function worldAabb(world: PhysicsWorld): Aabb {
  return {
    min: { x: 0, y: 0, z: 0 },
    max: { x: world.lengthCm, y: world.widthCm, z: world.heightCm },
  }
}

export function insideWorld(body: PhysicsBody, world: PhysicsWorld): boolean {
  return bodyInsideContainer(body, world)
}

export function hitsObstruction(body: PhysicsBody, world: PhysicsWorld): boolean {
  const aabb = bodyAabb(body)
  for (const block of world.obstructions) {
    const overlap =
      aabb.min.x < block.max.x - EPS_CM &&
      aabb.max.x > block.min.x + EPS_CM &&
      aabb.min.y < block.max.y - EPS_CM &&
      aabb.max.y > block.min.y + EPS_CM &&
      aabb.min.z < block.max.z - EPS_CM &&
      aabb.max.z > block.min.z + EPS_CM
    if (overlap) return true
  }
  return false
}

export function worldCollision(body: PhysicsBody, world: PhysicsWorld): Vec3 | null {
  const tol = world.toleranceCm
  if (body.shape === "cylinder" && body.cylinderAxis === "z") {
    const radius = cylinderRadius(body)
    if (body.cx - radius < -tol) return { x: 1, y: 0, z: 0 }
    if (body.cx + radius > world.lengthCm + tol) return { x: -1, y: 0, z: 0 }
    if (body.cy - radius < -tol) return { x: 0, y: 1, z: 0 }
    if (body.cy + radius > world.widthCm + tol) return { x: 0, y: -1, z: 0 }
    if (body.cz - body.hz < -tol) return { x: 0, y: 0, z: 1 }
    if (body.cz + body.hz > world.heightCm + tol) return { x: 0, y: 0, z: -1 }
  } else if (body.shape === "cylinder" && body.cylinderAxis === "x") {
    const radius = cylinderRadius(body)
    if (body.cx - body.hx < -tol) return { x: 1, y: 0, z: 0 }
    if (body.cx + body.hx > world.lengthCm + tol) return { x: -1, y: 0, z: 0 }
    if (body.cy - radius < -tol) return { x: 0, y: 1, z: 0 }
    if (body.cy + radius > world.widthCm + tol) return { x: 0, y: -1, z: 0 }
    if (body.cz - radius < -tol) return { x: 0, y: 0, z: 1 }
    if (body.cz + radius > world.heightCm + tol) return { x: 0, y: 0, z: -1 }
  } else if (body.shape === "cylinder" && body.cylinderAxis === "y") {
    const radius = cylinderRadius(body)
    if (body.cx - radius < -tol) return { x: 1, y: 0, z: 0 }
    if (body.cx + radius > world.lengthCm + tol) return { x: -1, y: 0, z: 0 }
    if (body.cy - body.hy < -tol) return { x: 0, y: 1, z: 0 }
    if (body.cy + body.hy > world.widthCm + tol) return { x: 0, y: -1, z: 0 }
    if (body.cz - radius < -tol) return { x: 0, y: 0, z: 1 }
    if (body.cz + radius > world.heightCm + tol) return { x: 0, y: 0, z: -1 }
  } else {
    const aabb = bodyAabb(body)
    if (aabb.min.x < -tol) return { x: 1, y: 0, z: 0 }
    if (aabb.max.x > world.lengthCm + tol) return { x: -1, y: 0, z: 0 }
    if (aabb.min.y < -tol) return { x: 0, y: 1, z: 0 }
    if (aabb.max.y > world.widthCm + tol) return { x: 0, y: -1, z: 0 }
    if (aabb.min.z < -tol) return { x: 0, y: 0, z: 1 }
    if (aabb.max.z > world.heightCm + tol) return { x: 0, y: 0, z: -1 }
  }
  if (hitsObstruction(body, world)) return { x: 0, y: 0, z: 1 }
  return null
}

export function blockedByOthers(body: PhysicsBody, others: PhysicsBody[]): PhysicsBody | null {
  for (const other of others) {
    if (other.id === body.id) continue
    if (bodiesOverlap(body, other)) return other
  }
  return null
}

export function movedBody(body: PhysicsBody, delta: Vec3): PhysicsBody {
  return { ...body, cx: body.cx + delta.x, cy: body.cy + delta.y, cz: body.cz + delta.z }
}
