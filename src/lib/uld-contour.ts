import { hasUldToken } from "./uld-kinds"

export type UldSideContour = {
  lengthMm: number
  heightMm: number
}

export type UldContour = {
  bottomLeft: UldSideContour
  bottomRight: UldSideContour
  topLeft: UldSideContour
  topRight: UldSideContour
}

function none(): UldSideContour {
  return { lengthMm: 0, heightMm: 0 }
}

function contour(partial: Partial<UldContour>): UldContour {
  return {
    bottomLeft: none(),
    bottomRight: none(),
    topLeft: none(),
    topRight: none(),
    ...partial,
  }
}

export function uldContour(name: string): UldContour | null {
  if (hasUldToken(name, "ld-3")) {
    return contour({ bottomRight: { lengthMm: 450, heightMm: 510 } })
  }
  if (hasUldToken(name, "ld-26")) {
    return contour({
      bottomLeft: { lengthMm: 470, heightMm: 470 },
      bottomRight: { lengthMm: 470, heightMm: 470 },
    })
  }
  if (hasUldToken(name, "ld-1") || hasUldToken(name, "ld-2") || hasUldToken(name, "ld-8") || hasUldToken(name, "ld3-45")) {
    return contour({ bottomRight: { lengthMm: 450, heightMm: 510 } })
  }
  if (hasUldToken(name, "a2n")) {
    return contour({
      topLeft: { lengthMm: 1075, heightMm: 910 },
      topRight: { lengthMm: 1075, heightMm: 910 },
    })
  }
  if (hasUldToken(name, "aan")) {
    return contour({
      topLeft: { lengthMm: 355, heightMm: 355 },
      topRight: { lengthMm: 355, heightMm: 355 },
    })
  }
  return null
}

export function emptyContour(): UldContour {
  return contour({})
}

export function hasUldSide(side: UldSideContour | undefined): boolean {
  return !!side && side.lengthMm > 0 && side.heightMm > 0
}

export function hasContourCuts(value: UldContour | null | undefined): boolean {
  if (!value) return false
  return (
    hasUldSide(value.bottomLeft) ||
    hasUldSide(value.bottomRight) ||
    hasUldSide(value.topLeft) ||
    hasUldSide(value.topRight)
  )
}

export function parseContour(value: unknown): UldContour {
  if (!value || typeof value !== "object") return emptyContour()
  const row = value as Partial<UldContour>
  return contour({
    bottomLeft: sideFrom(row.bottomLeft),
    bottomRight: sideFrom(row.bottomRight),
    topLeft: sideFrom(row.topLeft),
    topRight: sideFrom(row.topRight),
  })
}

function sideFrom(side: UldSideContour | undefined): UldSideContour | undefined {
  if (!side) return undefined
  const lengthMm = Number(side.lengthMm)
  const heightMm = Number(side.heightMm)
  if (!Number.isFinite(lengthMm) || !Number.isFinite(heightMm)) return undefined
  return { lengthMm, heightMm }
}

export function resolveEquipmentContour(name: string, stored: unknown): UldContour | null {
  const parsed = parseContour(stored)
  if (hasContourCuts(parsed)) return parsed
  return uldContour(name)
}

export function uldBoxVolumeM3(lengthCm: number, widthCm: number, heightCm: number): number {
  return (lengthCm * widthCm * heightCm) / 1_000_000
}

/** Bottom cuts run the length; top cuts run the width (Cargo-Planner A2N house). */
export function uldContourVolumeM3(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  contour: UldContour | null,
): number {
  const box = uldBoxVolumeM3(lengthCm, widthCm, heightCm)
  if (!contour) return box
  return (
    box -
    prismM3(contour.bottomLeft, lengthCm) -
    prismM3(contour.bottomRight, lengthCm) -
    prismM3(contour.topLeft, widthCm) -
    prismM3(contour.topRight, widthCm)
  )
}

function prismM3(side: UldSideContour, extrusionCm: number): number {
  if (side.lengthMm <= 0 || side.heightMm <= 0) return 0
  return 0.5 * (side.lengthMm / 1000) * (side.heightMm / 1000) * (extrusionCm / 100)
}
