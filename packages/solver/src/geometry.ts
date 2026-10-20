import type { SolverCargo, SolverOrientation, SolverShape } from "./types"

export type Dims = { l: number; w: number; h: number; rotation: string }

export type Box = {
  x: number
  y: number
  z: number
  l: number
  w: number
  h: number
}

export const EPS = 1e-6

export function orientationsFor(
  cargo: Pick<SolverCargo, "lengthCm" | "widthCm" | "heightCm" | "orientation" | "shape" | "allowedRotations">,
): Dims[] {
  const L = cargo.lengthCm
  const W = cargo.widthCm
  const H = cargo.heightCm
  const upright: Dims[] = [
    { l: L, w: W, h: H, rotation: "LWH" },
    { l: W, w: L, h: H, rotation: "WLH" },
  ]
  const tipped: Dims[] = [
    { l: L, w: H, h: W, rotation: "LHW" },
    { l: H, w: L, h: W, rotation: "HLW" },
    { l: W, w: H, h: L, rotation: "WHL" },
    { l: H, w: W, h: L, rotation: "HWL" },
  ]
  if (cargo.orientation === "CUSTOM") {
    const legal = uprightsFor("TILTABLE", cargo.shape, upright, tipped)
    const allow = new Set<string>(cargo.allowedRotations ?? [])
    const picked = legal.filter((dim) => allow.has(dim.rotation))
    return dedupe(picked.length > 0 ? picked : legal.slice(0, 1))
  }
  return dedupe(uprightsFor(cargo.orientation, cargo.shape, upright, tipped))
}

function uprightsFor(orientation: SolverOrientation, shape: SolverShape, upright: Dims[], tipped: Dims[]): Dims[] {
  if (shape === "CYLINDER_DRUM") {
    // A drum stands on its end. Tipping it is only allowed when it is explicitly tiltable or free.
    if (orientation === "TILTABLE" || orientation === "ANY") return [upright[0] as Dims, ...tipped.slice(0, 2)]
    return [upright[0] as Dims]
  }
  if (shape === "PIPE") {
    // A pipe lies along its length. It may turn in the plan view; never stood on end.
    if (orientation === "FIXED" || orientation === "LONGSHIP") return [upright[0] as Dims]
    return upright
  }
  switch (orientation) {
    case "FIXED":
    case "LONGSHIP":
      return [upright[0] as Dims]
    case "ROTATE_90":
      return upright
    case "TILTABLE":
    case "ANY":
    case "CUSTOM":
      return [...upright, ...tipped]
  }
}

function dedupe(dims: Dims[]): Dims[] {
  const seen = new Set<string>()
  const out: Dims[] = []
  for (const dim of dims) {
    const key = `${dim.l}|${dim.w}|${dim.h}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(dim)
  }
  return out
}

export function overlapArea(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y)
  if (dx <= EPS || dy <= EPS) return 0
  return dx * dy
}

export function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.l - EPS &&
    a.x + a.l > b.x + EPS &&
    a.y < b.y + b.w - EPS &&
    a.y + a.w > b.y + EPS &&
    a.z < b.z + b.h - EPS &&
    a.z + a.h > b.z + EPS
  )
}

export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.l <= outer.x + outer.l + EPS &&
    inner.y + inner.w <= outer.y + outer.w + EPS &&
    inner.z + inner.h <= outer.z + outer.h + EPS
  )
}

export function volume(box: Pick<Box, "l" | "w" | "h">): number {
  return box.l * box.w * box.h
}
