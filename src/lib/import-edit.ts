import { LENGTH_UNIT_SYMBOL, type LengthUnit } from "@/lib/cargo-units"
import type { Confirmation, ReviewLine, ReviewSource } from "@/lib/import-review"
import type { ImportWeightUnit } from "@/lib/import-units"

/**
 * What typing in the review table means. The table edits in place; these small rules decide what a
 * typed value becomes, so the same thing happens whichever cell it is typed in, and so it can be
 * tested without a browser.
 */

const WEIGHT_FIELDS = ["weight", "weightScope", "weightUnit", "weightKind", "quantity", "netWeight"]
const NUMBER_FIELDS = ["length", "width", "height", "quantity", "weight"]

/**
 * Applies a change to one line: the fields touched are remembered as the planner's own edits, and a
 * confirmation that no longer applies (a weight that was confirmed and has now changed) is taken away.
 */
export function applyEdit(line: ReviewLine, patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]): ReviewLine {
  const edited = [...new Set([...line.edited, ...touched.map(String)])]
  let confirmed: Confirmation[] = line.confirmed
  if (touched.some((field) => WEIGHT_FIELDS.includes(field))) confirmed = confirmed.filter((entry) => entry !== "weight" && entry !== "net")
  if (touched.some((field) => NUMBER_FIELDS.includes(field))) confirmed = confirmed.filter((entry) => entry !== "numbers")
  return { ...line, ...patch, edited, confirmed }
}

/**
 * A size typed in a column that shows `unit`. A plain number is in that unit, and is written back with
 * the unit so the line reads the same whatever its own unit was. Anything that carries its own unit
 * (5 ft 6 in, 1200 mm, 5'6") is kept as typed.
 */
export function dimensionText(typed: string, unit: LengthUnit): string {
  const text = typed.trim()
  return text !== "" && /^[\d.,\s]+$/.test(text) ? `${text} ${LENGTH_UNIT_SYMBOL[unit]}` : text
}

/**
 * A weight typed in the "kg / piece" column: the planning weight of one piece, in kilograms unless a
 * unit is written. Typing it settles what it is for, so a doubt about per piece or line total, or
 * about a net weight, is answered by it.
 */
export function weightPatch(typed: string, line: Pick<ReviewLine, "weightUnit" | "weightKind">): { patch: Partial<ReviewLine>; touched: (keyof ReviewLine)[] } {
  const text = typed.trim()
  const withUnit = text !== "" && /^[\d.,\s]+$/.test(text) ? `${text} kg` : text
  return {
    patch: { weight: withUnit, weightScope: "piece", weightUnit: line.weightUnit ?? "kg", weightKind: line.weightKind === "net" ? "unspecified" : line.weightKind },
    touched: ["weight", "weightScope", "weightKind"],
  }
}

/** One choice of unit for the rows that do not state their own. The numbers stay exactly as they were read. */
export function applySizeUnit(lines: ReviewLine[], ids: ReadonlySet<string>, unit: LengthUnit): ReviewLine[] {
  return lines.map((line) => (ids.has(line.id) ? applyEdit(line, { sizeUnit: unit }, ["sizeUnit"]) : line))
}

export function applyWeightUnit(lines: ReviewLine[], ids: ReadonlySet<string>, unit: ImportWeightUnit): ReviewLine[] {
  return lines.map((line) => (ids.has(line.id) ? applyEdit(line, { weightUnit: unit }, ["weightUnit"]) : line))
}

/** Where in the original to take the planner for a line. Only what the source really reported: nothing is invented. */
export type SourceTarget = { kind: "page"; page: number } | { kind: "row"; row: number; sheet?: string } | { kind: "quote"; quote: string } | { kind: "none" }

export function sourceTarget(source: ReviewSource): SourceTarget {
  if (source.page !== undefined) return { kind: "page", page: source.page }
  if (source.row !== undefined) return { kind: "row", row: source.row, ...(source.sheet ? { sheet: source.sheet } : {}) }
  if (source.quote) return { kind: "quote", quote: source.quote }
  return { kind: "none" }
}
