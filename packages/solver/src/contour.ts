import { EPS, type Box } from "./geometry"
import type { SolverContour, SolverContourSide, SolverEquipment } from "./types"

function side(contour: SolverContour | null | undefined, key: keyof SolverContour): SolverContourSide | null {
  const value = contour?.[key]
  if (!value || value.lengthCm <= 0 || value.heightCm <= 0) return null
  return value
}

export function hasSolverContour(contour: SolverContour | null | undefined): boolean {
  if (!contour) return false
  return Boolean(
    side(contour, "bottomLeft") ||
      side(contour, "bottomRight") ||
      side(contour, "topLeft") ||
      side(contour, "topRight"),
  )
}

/** Highest cargo top allowed at this length-position under a house roof. */
export function roofHeightAt(x: number, equipment: SolverEquipment): number {
  const height = equipment.heightCm
  const length = equipment.lengthCm
  const left = side(equipment.contour, "topLeft")
  const right = side(equipment.contour, "topRight")
  let max = height
  if (left && x < left.lengthCm - EPS) {
    const t = Math.max(0, x) / left.lengthCm
    max = Math.min(max, height - left.heightCm + t * left.heightCm)
  }
  if (right && x > length - right.lengthCm + EPS) {
    const t = Math.max(0, length - x) / right.lengthCm
    max = Math.min(max, height - right.heightCm + t * right.heightCm)
  }
  return max
}

export function aboveFloorCut(y: number, z: number, equipment: SolverEquipment): boolean {
  const width = equipment.widthCm
  const right = side(equipment.contour, "bottomRight")
  const left = side(equipment.contour, "bottomLeft")
  if (right && y < right.lengthCm - EPS && z < right.heightCm - EPS) {
    const slope = right.heightCm * (1 - y / right.lengthCm)
    if (z < slope - EPS) return false
  }
  if (left && y > width - left.lengthCm + EPS && z < left.heightCm - EPS) {
    const inset = width - y
    const slope = left.heightCm * (1 - inset / left.lengthCm)
    if (z < slope - EPS) return false
  }
  return true
}

export function boxFitsContour(box: Box, equipment: SolverEquipment): boolean {
  if (!hasSolverContour(equipment.contour)) return true
  const top = box.z + box.h
  if (top > roofHeightAt(box.x, equipment) + EPS) return false
  if (top > roofHeightAt(box.x + box.l, equipment) + EPS) return false
  if (!aboveFloorCut(box.y, box.z, equipment)) return false
  if (!aboveFloorCut(box.y + box.w, box.z, equipment)) return false
  return true
}

/**
 * Push a candidate from the space origin onto the remaining deck / under the
 * roof so cargo never sits in an LD-3 bottom cut or an A2N house slope.
 */
export function snapBoxToContour(
  space: Box,
  dim: { l: number; w: number; h: number },
  equipment: SolverEquipment,
): Box | null {
  if (dim.l > space.l + EPS || dim.w > space.w + EPS || dim.h > space.h + EPS) return null

  const z = space.z
  const y = Math.max(space.y, minYForFloor(z, equipment))
  const x = Math.max(space.x, minXForRoof(z + dim.h, equipment))
  if (y + dim.w > space.y + space.w + EPS) return null
  if (x + dim.l > space.x + space.l + EPS) return null
  if (x + dim.l > maxEndXForRoof(z + dim.h, equipment) + EPS) return null
  if (y + dim.w > maxYForFloor(z, equipment) + EPS) return null

  const box: Box = { x, y, z, l: dim.l, w: dim.w, h: dim.h }
  if (!boxFitsContour(box, equipment)) return null
  return box
}

function minYForFloor(z: number, equipment: SolverEquipment): number {
  const right = side(equipment.contour, "bottomRight")
  if (!right || z >= right.heightCm - EPS) return 0
  return right.lengthCm * (1 - z / right.heightCm)
}

function maxYForFloor(z: number, equipment: SolverEquipment): number {
  const left = side(equipment.contour, "bottomLeft")
  if (!left || z >= left.heightCm - EPS) return equipment.widthCm
  return equipment.widthCm - left.lengthCm * (1 - z / left.heightCm)
}

function minXForRoof(top: number, equipment: SolverEquipment): number {
  const height = equipment.heightCm
  const left = side(equipment.contour, "topLeft")
  if (top > height + EPS) return Number.POSITIVE_INFINITY
  if (!left || top <= height - left.heightCm + EPS) return 0
  return (left.lengthCm * (top - (height - left.heightCm))) / left.heightCm
}

function maxEndXForRoof(top: number, equipment: SolverEquipment): number {
  const height = equipment.heightCm
  const right = side(equipment.contour, "topRight")
  if (!right || top <= height - right.heightCm + EPS) return equipment.lengthCm
  return equipment.lengthCm - (right.lengthCm * (top - (height - right.heightCm))) / right.heightCm
}
