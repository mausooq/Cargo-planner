import type { Vec3 } from "./math"

export type CylinderAxis = "x" | "y" | "z"
export type BodyShape = "box" | "cylinder"

/**
 * Rigid body. Position is the geometric centre in cm.
 * Box half-extents (hx, hy, hz) are in the local frame; yawRad rotates about +Z.
 * A standing cylinder uses radius = min(hx, hy) and half-height = hz, axis z.
 */
export type PhysicsBody = {
  id: string
  shape: BodyShape
  cx: number
  cy: number
  cz: number
  hx: number
  hy: number
  hz: number
  yawRad: number
  cylinderAxis: CylinderAxis
  massKg: number
}

export type Aabb = {
  min: Vec3
  max: Vec3
}

export type PhysicsWorld = {
  lengthCm: number
  widthCm: number
  heightCm: number
  decksCm: number[]
  obstructions: Aabb[]
  minSupportRatio: number
  maxOverhangRatio: number
  toleranceCm: number
}

export type ContactPatch = {
  polygon: { x: number; y: number }[]
  areaCm2: number
}

export const DEFAULT_WORLD: PhysicsWorld = {
  lengthCm: 1355.6,
  widthCm: 235.2,
  heightCm: 270,
  decksCm: [0],
  obstructions: [],
  minSupportRatio: 0.7,
  maxOverhangRatio: 0.3,
  toleranceCm: 0.1,
}

export function boxBody(
  id: string,
  x: number,
  y: number,
  z: number,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  massKg = 1,
  yawRad = 0,
): PhysicsBody {
  return {
    id,
    shape: "box",
    cx: x + lengthCm / 2,
    cy: y + widthCm / 2,
    cz: z + heightCm / 2,
    hx: lengthCm / 2,
    hy: widthCm / 2,
    hz: heightCm / 2,
    yawRad,
    cylinderAxis: "z",
    massKg,
  }
}

export function cylinderBody(
  id: string,
  x: number,
  y: number,
  z: number,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  massKg = 1,
  cylinderAxis: CylinderAxis = "z",
): PhysicsBody {
  return {
    id,
    shape: "cylinder",
    cx: x + lengthCm / 2,
    cy: y + widthCm / 2,
    cz: z + heightCm / 2,
    hx: lengthCm / 2,
    hy: widthCm / 2,
    hz: heightCm / 2,
    yawRad: 0,
    cylinderAxis,
    massKg,
  }
}

export function minCorner(body: PhysicsBody): { x: number; y: number; z: number } {
  return {
    x: body.cx - body.hx,
    y: body.cy - body.hy,
    z: body.cz - body.hz,
  }
}

export function bodyBottom(body: PhysicsBody): number {
  return body.cz - body.hz
}

export function bodyTop(body: PhysicsBody): number {
  return body.cz + body.hz
}
