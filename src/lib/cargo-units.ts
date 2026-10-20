export const LENGTH_UNITS = ["cm", "in", "m"] as const
export type LengthUnit = (typeof LENGTH_UNITS)[number]

export const LENGTH_UNIT_LABEL: Record<LengthUnit, string> = {
  cm: "cm",
  in: "inch",
  m: "meter",
}

export function toDisplayLength(cm: number, unit: LengthUnit): number {
  if (unit === "in") return cm / 2.54
  if (unit === "m") return cm / 100
  return cm
}

export function fromDisplayLength(value: number, unit: LengthUnit): number {
  if (unit === "in") return value * 2.54
  if (unit === "m") return value * 100
  return value
}

export function roundDisplayLength(value: number, unit: LengthUnit): number {
  const digits = unit === "m" ? 3 : unit === "in" ? 2 : 1
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
