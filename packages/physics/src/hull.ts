import { cross2, FINE_EPS, type Vec2 } from "./math"

export function convexHull(points: Vec2[]): Vec2[] {
  const unique = dedupe(points)
  if (unique.length <= 2) return unique
  unique.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const lower: Vec2[] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, point) <= FINE_EPS) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: Vec2[] = []
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i] as Vec2
    while (upper.length >= 2 && cross2(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, point) <= FINE_EPS) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) {
    if (points.length === 2) {
      const a = points[0] as Vec2
      const b = points[1] as Vec2
      return Math.hypot(b.x - a.x, b.y - a.y) * FINE_EPS
    }
    return 0
  }
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % points.length] as Vec2
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function pointInPolygon(point: Vec2, polygon: Vec2[], eps = 1e-6): boolean {
  if (polygon.length === 0) return false
  if (polygon.length === 1) {
    const only = polygon[0] as Vec2
    return Math.hypot(point.x - only.x, point.y - only.y) <= eps
  }
  if (onBoundary(point, polygon, eps)) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i] as Vec2
    const b = polygon[j] as Vec2
    const intersect = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + FINE_EPS) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

function onBoundary(point: Vec2, polygon: Vec2[], eps: number): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i] as Vec2
    const b = polygon[(i + 1) % polygon.length] as Vec2
    if (pointOnSegment(point, a, b, eps)) return true
  }
  return false
}

function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps: number): boolean {
  const cross = Math.abs((p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y))
  if (cross > eps * (Math.hypot(b.x - a.x, b.y - a.y) + 1)) return false
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
  if (dot < -eps) return false
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return dot <= len2 + eps
}

function dedupe(points: Vec2[]): Vec2[] {
  const seen = new Set<string>()
  const out: Vec2[] = []
  for (const point of points) {
    const key = `${point.x.toFixed(4)}:${point.y.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(point)
  }
  return out
}
