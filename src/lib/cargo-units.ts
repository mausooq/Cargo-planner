/**
 * Length units for entering and showing cargo sizes.
 *
 * Storage never changes: every size is kept in centimetres (`lengthCm`, `widthCm`, `heightCm`), the
 * solver works in centimetres, and weight stays in kilograms. A unit chosen here only decides how a
 * size is typed and shown. This file is the ONE place that knows how to convert; the grid, the
 * importer, the exports and the other screens all use it.
 *
 * Switching the displayed unit never writes anything: the stored centimetres are untouched and only
 * the text on screen is formatted again. A stored value changes only when the user types a new one.
 */

export const LENGTH_UNITS = ["mm", "cm", "m", "in", "ft"] as const
export type LengthUnit = (typeof LENGTH_UNITS)[number]

/** Centimetres in one of each unit. The single conversion table. */
export const CM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.1,
  cm: 1,
  m: 100,
  in: 2.54,
  ft: 30.48,
}

/** Names for the unit picker. Existing labels are kept as they were. */
export const LENGTH_UNIT_LABEL: Record<LengthUnit, string> = {
  mm: "mm",
  cm: "cm",
  m: "meter",
  in: "inch",
  ft: "feet",
}

/** The short symbol used in column titles and reports: "ft", "in", "cm". */
export const LENGTH_UNIT_SYMBOL: Record<LengthUnit, string> = {
  mm: "mm",
  cm: "cm",
  m: "m",
  in: "in",
  ft: "ft",
}

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === "string" && (LENGTH_UNITS as readonly string[]).includes(value)
}

export function toDisplayLength(cm: number, unit: LengthUnit): number {
  return cm / CM_PER_UNIT[unit]
}

export function fromDisplayLength(value: number, unit: LengthUnit): number {
  return value * CM_PER_UNIT[unit]
}

const DISPLAY_DIGITS: Record<LengthUnit, number> = { mm: 1, cm: 1, m: 3, in: 2, ft: 3 }

/** Rounds for showing only. Never use the result as a value to store. */
export function roundDisplayLength(value: number, unit: LengthUnit): number {
  const factor = 10 ** DISPLAY_DIGITS[unit]
  return Math.round(value * factor) / factor
}

/** Stored sizes keep 0.0001 cm (a tenth of a micron), which removes float noise without losing anything real. */
export function roundStoredCm(cm: number): number {
  return Math.round(cm * 10000) / 10000
}

/** A size in the unit as a plain number for a text box. Empty for zero or nonsense. */
export function displayLengthText(cm: number, unit: LengthUnit): string {
  if (!Number.isFinite(cm) || cm === 0) return ""
  return String(roundDisplayLength(toDisplayLength(cm, unit), unit))
}

/** A size with its unit, for reading: "5.5 ft", "120 cm". */
export function formatLengthIn(cm: number, unit: LengthUnit): string {
  const value = roundDisplayLength(toDisplayLength(cm, unit), unit)
  return `${value.toLocaleString("en-US", { maximumFractionDigits: DISPLAY_DIGITS[unit] })} ${LENGTH_UNIT_SYMBOL[unit]}`
}

/** A size as feet and inches, for a hint beside a decimal-feet value: "5 ft 6 in". */
export function feetAndInches(cm: number): string {
  const totalInches = Math.round((cm / 2.54) * 10) / 10
  let feet = Math.floor(totalInches / 12)
  let inches = Math.round((totalInches - feet * 12) * 10) / 10
  if (inches >= 12) {
    feet += 1
    inches = 0
  }
  return `${feet} ft ${inches} in`
}

export type LengthParse = { ok: true; cm: number } | { ok: false; reason: string }

const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?|[.,]\d+)`
const FEET_WORD = String.raw`(?:ft|feet|foot)`
const INCH_WORD = String.raw`(?:in|inch|inches)`

const UNIT_BY_WORD: Record<string, LengthUnit> = {
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  cm: "cm",
  centimetre: "cm",
  centimetres: "cm",
  centimeter: "cm",
  centimeters: "cm",
  m: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  in: "in",
  inch: "in",
  inches: "in",
  '"': "in",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  "'": "ft",
}

/** The unit a written word means ("ft", "feet", "inches", "mm", ...), or null. Used to read units from column titles. */
export function lengthUnitFromWord(word: string): LengthUnit | null {
  return UNIT_BY_WORD[word.trim().toLowerCase()] ?? null
}

function decimal(token: string): number {
  return Number(token.replace(",", "."))
}

const HINT = `Use a number, or feet and inches such as 5 ft 6 in or 5'6".`

/**
 * Reads a size typed by a person. A plain number is in `defaultUnit` (so 5.6 in feet is five and six
 * tenths feet, never 5 ft 6 in). A unit written after the number (mm, cm, m, in, ft, ' or ") wins over
 * `defaultUnit`. Feet and inches are written together, `5 ft 6 in` or `5'6"`; the inches part must be
 * under 12, because `5 ft 14 in` is most likely a typing slip. Returns centimetres.
 */
export function parseLength(text: string, defaultUnit: LengthUnit): LengthParse {
  const raw = text
    .trim()
    .toLowerCase()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/''/g, '"')
  if (raw === "") return { ok: false, reason: "Enter a size." }
  if (raw.startsWith("-")) return { ok: false, reason: "A size cannot be negative." }

  // Feet and inches written out: 5 ft 6 in, 5ft6in, 5 feet 6.5 inches.
  let match = new RegExp(`^(\\d+)\\s*${FEET_WORD}\\s*(${NUMBER})\\s*(?:${INCH_WORD}|")$`).exec(raw)
  // The apostrophe form: 5'6", 5' 6", 5'6, 5'.
  match ??= new RegExp(`^(\\d+)\\s*'\\s*(?:(${NUMBER})\\s*(?:${INCH_WORD}|")?)?$`).exec(raw)
  if (match) {
    const feet = Number(match[1])
    const inches = match[2] === undefined ? 0 : decimal(match[2])
    if (inches >= 12) return { ok: false, reason: `${inches} in is a foot or more. Write it as feet and inches under 12, for example 6 ft 2 in.` }
    return { ok: true, cm: roundStoredCm((feet * 12 + inches) * 2.54) }
  }

  // A number with an optional unit after it: 120, 120 cm, 4.5 ft, 6", 3'.
  const simple = new RegExp(`^(${NUMBER})\\s*([a-z]+|"|')?$`).exec(raw)
  if (simple) {
    const unit = simple[2] === undefined ? defaultUnit : UNIT_BY_WORD[simple[2]]
    if (!unit) return { ok: false, reason: `“${simple[2]}” is not a length unit. ${HINT}` }
    return { ok: true, cm: roundStoredCm(fromDisplayLength(decimal(simple[1]!), unit)) }
  }

  return { ok: false, reason: HINT }
}

/**
 * What typing in a size box means for the stored value: nothing yet (blank), the same value as
 * before (so nothing is saved), a new value in centimetres, or something that cannot be read.
 */
export type LengthEdit =
  | { kind: "blank" }
  | { kind: "same" }
  | { kind: "changed"; cm: number }
  | { kind: "invalid"; reason: string }

/** Two sizes are the same value when they agree to the precision that is stored. */
export function sameStoredLength(a: number, b: number): boolean {
  return Math.abs(roundStoredCm(a) - roundStoredCm(b)) < 0.00005
}

export function interpretLengthEdit(text: string, unit: LengthUnit, currentCm: number): LengthEdit {
  if (text.trim() === "") return { kind: "blank" }
  const parsed = parseLength(text, unit)
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason }
  // Typing back what is already shown (a rounded figure) must not rewrite the stored value.
  if (text.trim() === displayLengthText(currentCm, unit)) return { kind: "same" }
  return sameStoredLength(parsed.cm, currentCm) ? { kind: "same" } : { kind: "changed", cm: parsed.cm }
}

/**
 * A size for a table cell, without its unit (the column title carries it). Centimetres keep the
 * whole-number look the plan tables always had; the other units use their own precision.
 */
export function lengthCellText(cm: number, unit: LengthUnit): string {
  if (unit === "cm") return String(Math.round(cm))
  return String(roundDisplayLength(toDisplayLength(cm, unit), unit))
}
