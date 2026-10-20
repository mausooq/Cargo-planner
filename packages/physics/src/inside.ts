import { cylinderRadius } from "./collision"
import { bodyAabb } from "./aabb"
import type { PhysicsBody, PhysicsWorld } from "./types"

/** True only if the real volume (circle for cylinders, OBB for boxes) is inside the inner box. */
export function bodyInsideContainer(body: PhysicsBody, world: PhysicsWorld): boolean {
  const tol = world.toleranceCm
  if (body.cz - body.hz < -tol || body.cz + body.hz > world.heightCm + tol) return false

  if (body.shape === "cylinder" && body.cylinderAxis === "z") {
    const radius = cylinderRadius(body)
    if (body.cx - radius < -tol || body.cx + radius > world.lengthCm + tol) return false
    if (body.cy - radius < -tol || body.cy + radius > world.widthCm + tol) return false
    return !hitsBlock(body, world)
  }

  if (body.shape === "cylinder" && body.cylinderAxis === "x") {
    const radius = cylinderRadius(body)
    if (body.cx - body.hx < -tol || body.cx + body.hx > world.lengthCm + tol) return false
    if (body.cy - radius < -tol || body.cy + radius > world.widthCm + tol) return false
    if (body.cz - radius < -tol || body.cz + radius > world.heightCm + tol) return false
    return !hitsBlock(body, world)
  }

  if (body.shape === "cylinder" && body.cylinderAxis === "y") {
    const radius = cylinderRadius(body)
    if (body.cy - body.hy < -tol || body.cy + body.hy > world.widthCm + tol) return false
    if (body.cx - radius < -tol || body.cx + radius > world.lengthCm + tol) return false
    if (body.cz - radius < -tol || body.cz + radius > world.heightCm + tol) return false
    return !hitsBlock(body, world)
  }

  const c = Math.cos(body.yawRad)
  const s = Math.sin(body.yawRad)
  const corners = [
    { x: c * body.hx - s * body.hy, y: s * body.hx + c * body.hy },
    { x: -c * body.hx - s * body.hy, y: -s * body.hx + c * body.hy },
    { x: -c * body.hx + s * body.hy, y: -s * body.hx - c * body.hy },
    { x: c * body.hx + s * body.hy, y: s * body.hx - c * body.hy },
  ]
  for (const corner of corners) {
    const x = body.cx + corner.x
    const y = body.cy + corner.y
    if (x < -tol || x > world.lengthCm + tol || y < -tol || y > world.widthCm + tol) return false
  }
  return !hitsBlock(body, world)
}

function hitsBlock(body: PhysicsBody, world: PhysicsWorld): boolean {
  if (world.obstructions.length === 0) return false
  const aabb = bodyAabb(body)
  const tol = world.toleranceCm
  return world.obstructions.some(
    (block) =>
      aabb.min.x < block.max.x - tol &&
      aabb.max.x > block.min.x + tol &&
      aabb.min.y < block.max.y - tol &&
      aabb.max.y > block.min.y + tol &&
      aabb.min.z < block.max.z - tol &&
      aabb.max.z > block.min.z + tol,
  )
}
