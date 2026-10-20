import { cylinderRadius } from "./collision"
import { convexHull, pointInPolygon, polygonArea } from "./hull"
import { EPS_CM, type Vec2 } from "./math"
import type { ContactPatch, PhysicsBody, PhysicsWorld } from "./types"

export type SupportResult = {
  polygon: Vec2[]
  areaCm2: number
  baseAreaCm2: number
  areaRatio: number
  overhangRatio: number
  cogInside: boolean
  stable: boolean
}

export function footprintCorners(body: PhysicsBody): Vec2[] {
  if (body.shape === "cylinder" && body.cylinderAxis === "z") {
    const r = cylinderRadius(body)
    const steps = 16
    return Array.from({ length: steps }, (_, i) => {
      const a = (i / steps) * Math.PI * 2
      return { x: body.cx + Math.cos(a) * r, y: body.cy + Math.sin(a) * r }
    })
  }
  const c = Math.cos(body.yawRad)
  const s = Math.sin(body.yawRad)
  return [
    { x: body.cx + c * body.hx - s * body.hy, y: body.cy + s * body.hx + c * body.hy },
    { x: body.cx - c * body.hx - s * body.hy, y: body.cy - s * body.hx + c * body.hy },
    { x: body.cx - c * body.hx + s * body.hy, y: body.cy - s * body.hx - c * body.hy },
    { x: body.cx + c * body.hx + s * body.hy, y: body.cy + s * body.hx - c * body.hy },
  ]
}

export function baseArea(body: PhysicsBody): number {
  if (body.shape === "cylinder" && body.cylinderAxis === "z") {
    const r = cylinderRadius(body)
    return Math.PI * r * r
  }
  if (body.shape === "cylinder") {
    const r = cylinderRadius(body)
    const length = body.cylinderAxis === "x" ? body.hx * 2 : body.hy * 2
    return 2 * r * length
  }
  return body.hx * 2 * (body.hy * 2)
}

export function rectangleIntersection(a: PhysicsBody, b: PhysicsBody): Vec2[] {
  const ax0 = a.cx - a.hx
  const ax1 = a.cx + a.hx
  const ay0 = a.cy - a.hy
  const ay1 = a.cy + a.hy
  const bx0 = b.cx - b.hx
  const bx1 = b.cx + b.hx
  const by0 = b.cy - b.hy
  const by1 = b.cy + b.hy
  const x0 = Math.max(ax0, bx0)
  const y0 = Math.max(ay0, by0)
  const x1 = Math.min(ax1, bx1)
  const y1 = Math.min(ay1, by1)
  if (x1 - x0 <= EPS_CM || y1 - y0 <= EPS_CM) return []
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
}

export function contactWithFloor(body: PhysicsBody): ContactPatch {
  const polygon = convexHull(footprintCorners(body))
  return { polygon, areaCm2: baseArea(body) }
}

export function contactWithBody(upper: PhysicsBody, lower: PhysicsBody): ContactPatch {
  const points = rectangleIntersection(upper, lower)
  const polygon = convexHull(points)
  return { polygon, areaCm2: polygonArea(polygon) }
}

export function supportFrom(body: PhysicsBody, supports: PhysicsBody[], world: PhysicsWorld): SupportResult {
  const patches: Vec2[] = []
  let area = 0
  const floor = nearestDeck(body, world)
  const onFloor = Math.abs(body.cz - body.hz - floor) <= world.toleranceCm + EPS_CM
  if (onFloor) {
    const floorPatch = contactWithFloor(body)
    patches.push(...floorPatch.polygon)
    area += floorPatch.areaCm2
  }
  for (const other of supports) {
    if (other.id === body.id) continue
    const gap = body.cz - body.hz - (other.cz + other.hz)
    if (Math.abs(gap) > world.toleranceCm + EPS_CM) continue
    const patch = contactWithBody(body, other)
    if (patch.areaCm2 <= 0) continue
    patches.push(...patch.polygon)
    area += patch.areaCm2
  }
  const polygon = convexHull(patches)
  const hullArea = polygon.length >= 3 ? polygonArea(polygon) : area
  const supportArea = Math.max(hullArea, area)
  const base = baseArea(body)
  const cog: Vec2 = { x: body.cx, y: body.cy }
  const cogInside = polygon.length === 0 ? false : pointInPolygon(cog, polygon, world.toleranceCm)
  const areaRatio = base > 0 ? supportArea / base : 0
  return {
    polygon,
    areaCm2: supportArea,
    baseAreaCm2: base,
    areaRatio,
    overhangRatio: Math.max(0, 1 - areaRatio),
    cogInside,
    stable: areaRatio + 1e-9 >= world.minSupportRatio && cogInside && areaRatio + 1e-9 >= 1 - world.maxOverhangRatio,
  }
}

export function nearestDeck(body: PhysicsBody, world: PhysicsWorld): number {
  const bottom = body.cz - body.hz
  let best = world.decksCm[0] ?? 0
  for (const deck of world.decksCm) {
    if (deck <= bottom + world.toleranceCm && deck >= best) best = deck
  }
  return best
}
