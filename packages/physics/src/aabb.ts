import { EPS_CM } from "./math"
import type { Aabb, PhysicsBody } from "./types"

export function bodyAabb(body: PhysicsBody): Aabb {
  if (body.shape === "cylinder") {
    const radius =
      body.cylinderAxis === "x"
        ? Math.min(body.hy, body.hz)
        : body.cylinderAxis === "y"
          ? Math.min(body.hx, body.hz)
          : Math.min(body.hx, body.hy)
    if (body.cylinderAxis === "x") {
      return {
        min: { x: body.cx - body.hx, y: body.cy - radius, z: body.cz - radius },
        max: { x: body.cx + body.hx, y: body.cy + radius, z: body.cz + radius },
      }
    }
    if (body.cylinderAxis === "y") {
      return {
        min: { x: body.cx - radius, y: body.cy - body.hy, z: body.cz - radius },
        max: { x: body.cx + radius, y: body.cy + body.hy, z: body.cz + radius },
      }
    }
    return {
      min: { x: body.cx - radius, y: body.cy - radius, z: body.cz - body.hz },
      max: { x: body.cx + radius, y: body.cy + radius, z: body.cz + body.hz },
    }
  }
  const c = Math.cos(body.yawRad)
  const s = Math.sin(body.yawRad)
  const extX = Math.abs(c) * body.hx + Math.abs(s) * body.hy
  const extY = Math.abs(s) * body.hx + Math.abs(c) * body.hy
  return {
    min: { x: body.cx - extX, y: body.cy - extY, z: body.cz - body.hz },
    max: { x: body.cx + extX, y: body.cy + extY, z: body.cz + body.hz },
  }
}

export function aabbOverlap(a: Aabb, b: Aabb, eps = EPS_CM): boolean {
  return (
    a.min.x < b.max.x - eps &&
    a.max.x > b.min.x + eps &&
    a.min.y < b.max.y - eps &&
    a.max.y > b.min.y + eps &&
    a.min.z < b.max.z - eps &&
    a.max.z > b.min.z + eps
  )
}

export function aabbVolume(a: Aabb): number {
  return Math.max(0, a.max.x - a.min.x) * Math.max(0, a.max.y - a.min.y) * Math.max(0, a.max.z - a.min.z)
}

export function aabbIntersection(a: Aabb, b: Aabb): Aabb | null {
  const minX = Math.max(a.min.x, b.min.x)
  const minY = Math.max(a.min.y, b.min.y)
  const minZ = Math.max(a.min.z, b.min.z)
  const maxX = Math.min(a.max.x, b.max.x)
  const maxY = Math.min(a.max.y, b.max.y)
  const maxZ = Math.min(a.max.z, b.max.z)
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return null
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } }
}

export function aabbContains(outer: Aabb, inner: Aabb, eps = EPS_CM): boolean {
  return (
    inner.min.x >= outer.min.x - eps &&
    inner.min.y >= outer.min.y - eps &&
    inner.min.z >= outer.min.z - eps &&
    inner.max.x <= outer.max.x + eps &&
    inner.max.y <= outer.max.y + eps &&
    inner.max.z <= outer.max.z + eps
  )
}
