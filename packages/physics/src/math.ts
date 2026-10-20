export const G_MPS2 = 9.81
export const EPS_CM = 0.1
export const FINE_EPS = 1e-6

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function nearlyEqual(a: number, b: number, eps = EPS_CM): boolean {
  return Math.abs(a - b) <= eps
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

export function length2(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function scale3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function length3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function normalize3(a: Vec3): Vec3 {
  const len = length3(a)
  if (len < FINE_EPS) return { x: 0, y: 0, z: 0 }
  return scale3(a, 1 / len)
}
