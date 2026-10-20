import { aabbOverlap, bodyAabb } from "./aabb"
import { clamp, EPS_CM, FINE_EPS } from "./math"
import type { PhysicsBody } from "./types"

export function bodiesOverlap(a: PhysicsBody, b: PhysicsBody, eps = EPS_CM): boolean {
  if (!aabbOverlap(bodyAabb(a), bodyAabb(b), eps)) return false
  if (a.shape === "box" && b.shape === "box") return boxesOverlap(a, b, eps)
  if (a.shape === "cylinder" && b.shape === "cylinder") return cylindersOverlap(a, b, eps)
  return a.shape === "cylinder" ? cylinderBoxOverlap(a, b, eps) : cylinderBoxOverlap(b, a, eps)
}

export function boxesOverlap(a: PhysicsBody, b: PhysicsBody, eps = EPS_CM): boolean {
  if (Math.abs(a.yawRad) < FINE_EPS && Math.abs(b.yawRad) < FINE_EPS) {
    return aabbOverlap(bodyAabb(a), bodyAabb(b), eps)
  }
  return satOverlapXY(a, b, eps)
}

function satOverlapXY(a: PhysicsBody, b: PhysicsBody, eps: number): boolean {
  if (a.cz - a.hz >= b.cz + b.hz - eps || b.cz - b.hz >= a.cz + a.hz - eps) return false
  const axes = [...bodyAxes(a), ...bodyAxes(b)]
  for (const axis of axes) {
    const pa = projectOn(a, axis)
    const pb = projectOn(b, axis)
    if (pa.max <= pb.min + eps || pb.max <= pa.min + eps) return false
  }
  return true
}

function bodyAxes(body: PhysicsBody): { x: number; y: number }[] {
  const c = Math.cos(body.yawRad)
  const s = Math.sin(body.yawRad)
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ]
}

function projectOn(body: PhysicsBody, axis: { x: number; y: number }): { min: number; max: number } {
  const c = Math.cos(body.yawRad)
  const s = Math.sin(body.yawRad)
  const corners = [
    { x: body.cx + c * body.hx - s * body.hy, y: body.cy + s * body.hx + c * body.hy },
    { x: body.cx - c * body.hx - s * body.hy, y: body.cy - s * body.hx + c * body.hy },
    { x: body.cx - c * body.hx + s * body.hy, y: body.cy - s * body.hx - c * body.hy },
    { x: body.cx + c * body.hx + s * body.hy, y: body.cy + s * body.hx - c * body.hy },
  ]
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const corner of corners) {
    const d = corner.x * axis.x + corner.y * axis.y
    if (d < min) min = d
    if (d > max) max = d
  }
  return { min, max }
}

export function cylinderRadius(body: PhysicsBody): number {
  if (body.cylinderAxis === "x") return Math.min(body.hy, body.hz)
  if (body.cylinderAxis === "y") return Math.min(body.hx, body.hz)
  return Math.min(body.hx, body.hy)
}

export function cylindersOverlap(a: PhysicsBody, b: PhysicsBody, eps = EPS_CM): boolean {
  if (a.cylinderAxis === "z" && b.cylinderAxis === "z") {
    if (a.cz - a.hz >= b.cz + b.hz - eps || b.cz - b.hz >= a.cz + a.hz - eps) return false
    const dx = a.cx - b.cx
    const dy = a.cy - b.cy
    const limit = cylinderRadius(a) + cylinderRadius(b) - eps
    return dx * dx + dy * dy < limit * limit
  }
  return aabbOverlap(bodyAabb(a), bodyAabb(b), eps) && circleRectOnPlane(a, b, eps)
}

export function cylinderBoxOverlap(cyl: PhysicsBody, box: PhysicsBody, eps = EPS_CM): boolean {
  if (cyl.cylinderAxis === "z") {
    if (cyl.cz - cyl.hz >= box.cz + box.hz - eps || box.cz - box.hz >= cyl.cz + cyl.hz - eps) return false
    return circleHitsAabbXY(cyl.cx, cyl.cy, cylinderRadius(cyl), box, eps)
  }
  if (cyl.cylinderAxis === "x") {
    if (cyl.cx - cyl.hx >= box.cx + box.hx - eps || box.cx - box.hx >= cyl.cx + cyl.hx - eps) return false
    return circleHitsRect(cyl.cy, cyl.cz, cylinderRadius(cyl), box.cy - box.hy, box.cy + box.hy, box.cz - box.hz, box.cz + box.hz, eps)
  }
  if (cyl.cy - cyl.hy >= box.cy + box.hy - eps || box.cy - box.hy >= cyl.cy + cyl.hy - eps) return false
  return circleHitsRect(cyl.cx, cyl.cz, cylinderRadius(cyl), box.cx - box.hx, box.cx + box.hx, box.cz - box.hz, box.cz + box.hz, eps)
}

function circleHitsAabbXY(cx: number, cy: number, radius: number, box: PhysicsBody, eps: number): boolean {
  const minX = box.cx - box.hx
  const maxX = box.cx + box.hx
  const minY = box.cy - box.hy
  const maxY = box.cy + box.hy
  const closestX = clamp(cx, minX, maxX)
  const closestY = clamp(cy, minY, maxY)
  const dx = cx - closestX
  const dy = cy - closestY
  const limit = radius - eps
  return dx * dx + dy * dy < limit * limit
}

function circleHitsRect(
  cx: number,
  cy: number,
  radius: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  eps: number,
): boolean {
  const dx = cx - clamp(cx, minX, maxX)
  const dy = cy - clamp(cy, minY, maxY)
  const limit = radius - eps
  return dx * dx + dy * dy < limit * limit
}

function circleRectOnPlane(a: PhysicsBody, b: PhysicsBody, eps: number): boolean {
  if (a.cylinderAxis === "x" && b.cylinderAxis === "x") {
    if (a.cx - a.hx >= b.cx + b.hx - eps || b.cx - b.hx >= a.cx + a.hx - eps) return false
    const dx = a.cy - b.cy
    const dy = a.cz - b.cz
    const limit = cylinderRadius(a) + cylinderRadius(b) - eps
    return dx * dx + dy * dy < limit * limit
  }
  return aabbOverlap(bodyAabb(a), bodyAabb(b), eps)
}
