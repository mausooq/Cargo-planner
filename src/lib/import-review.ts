import type { CargoItemInput, CargoShape, Orientation } from "@compass/domain"
import { cargoPreset } from "@/lib/cargo-defaults"
import type { LengthUnit } from "@/lib/cargo-units"
import { readNumber, readSize, parseWeight, type ImportWeightUnit } from "@/lib/import-units"

/**
 * The review model for packing-list import. Every import route (spreadsheet columns, a file read by
 * Claude, pasted text) ends in the same `ReviewLine`s; this file decides, in one place, what each
 * line means: its status, what is missing or unclear, the cargo line it would create, and the totals.
 *
 * Nothing here invents a value. A blank stays blank and is reported as missing; a weight that is a
 * line total becomes a per-piece weight only when the quantity is known, and only after the planner
 * confirms it. Values the planner types are marked as theirs.
 */

export type FieldOrigin = "source" | "calculated" | "user"

/** Where on the source a line was read from. Only what the source or the reader really reported. */
export type ReviewSource = {
  sheet?: string
  row?: number
  page?: number
  /** Cell references such as "B5:F5", when known. */
  cells?: string
  /** A short piece of the original text the values came from. */
  quote?: string
}

export type WeightScope = "piece" | "line" | "unclear"
export type WeightKind = "gross" | "net" | "unspecified"
/** Things the planner has looked at and accepted. Changing the related value takes the acceptance away. */
export type Confirmation = "weight" | "numbers" | "net"

export type ReviewLine = {
  id: string
  include: boolean
  sku: string
  name: string
  /** A translation of the description, shown beside it. The original text in `name` is never overwritten. */
  translation: string
  length: string
  width: string
  height: string
  /** The unit the three sizes are in, when the document states it; null until the planner chooses. */
  sizeUnit: LengthUnit | null
  quantity: string
  weight: string
  weightScope: WeightScope
  weightUnit: ImportWeightUnit | null
  weightKind: WeightKind
  shape: CargoShape
  /** Only set when the document says so; null leaves the planner's normal default. */
  stackable: boolean | null
  floorOnly: boolean | null
  orientation: Orientation | null
  consignment: string
  /** Unloading stop number as written. Blank means the first stop. */
  destination: string
  hazard: string
  /** Handling instructions: kept for the planner to read, not stored on the cargo line. */
  handling: string
  /** An explicit clearance requirement in cm per side. Blank means the project default applies. */
  clearance: string
  source: ReviewSource
  /** Doubts the reading model reported itself. These are not independently checked. */
  modelNotes: string[]
  /** Differences found by checking the numbers against each other. */
  checks: string[]
  /** Fields the planner changed. */
  edited: string[]
  confirmed: Confirmation[]
  /** Problems found while reading the source row (a shape or flag that is not one of the allowed words). They block the line until fixed or excluded. */
  rowIssues: { field: string; message: string }[]
  /** Spreadsheet columns that have no field of their own in the review table; carried through to the cargo line unchanged. */
  extras: Partial<Pick<CargoItemInput, "maxStackLoadKg" | "maxStackLayers" | "priority" | "color" | "allowedRotations">>
}

export function blankLine(id: string): ReviewLine {
  return {
    id,
    include: true,
    sku: "",
    name: "",
    translation: "",
    length: "",
    width: "",
    height: "",
    sizeUnit: null,
    quantity: "",
    weight: "",
    weightScope: "piece",
    weightUnit: null,
    weightKind: "unspecified",
    shape: "BOX",
    stackable: null,
    floorOnly: null,
    orientation: null,
    consignment: "",
    destination: "",
    hazard: "",
    handling: "",
    clearance: "",
    source: {},
    modelNotes: [],
    checks: [],
    edited: [],
    confirmed: [],
    rowIssues: [],
    extras: {},
  }
}

export type IssueKind = "missing" | "ambiguous" | "invalid" | "confirm"
export type LineIssue = { field: string; kind: IssueKind; message: string }
export type LineStatus = "ready" | "corrected" | "missing" | "ambiguous" | "invalid" | "excluded"

export const STATUS_LABEL: Record<LineStatus, string> = {
  ready: "Ready for review",
  corrected: "User corrected",
  missing: "Missing required information",
  ambiguous: "Ambiguous value",
  invalid: "Invalid value",
  excluded: "Excluded from import",
}

export type LineEval = {
  status: LineStatus
  issues: LineIssue[]
  /** The cargo line this would create. Null while anything blocks it. */
  input: CargoItemInput | null
  pieces: number | null
  perPieceKg: number | null
  lineKg: number | null
  volumeM3: number | null
  /** Sizes in cm, when all three are known. */
  sizesCm: [number, number, number] | null
  /** How a per-piece weight was worked out from a line total, in words. */
  interpretation: string | null
  /** Which values came from the source, were calculated, or were typed by the planner. */
  origins: Record<string, FieldOrigin>
}

const SIZE_FIELDS = ["length", "width", "height"] as const

function originOf(line: ReviewLine, field: string): FieldOrigin {
  return line.edited.includes(field) ? "user" : "source"
}

/** A count such as "10", "10 pcs" or "1.200": a whole number, plus whether its format was ambiguous. */
function readCount(text: string): { value: number; ambiguous: boolean } | null {
  const match = /^\s*([\d.,'’\s]+?)\s*(?:[A-Za-z]{1,12}\.?)?\s*$/.exec(text)
  if (!match) return null
  return readNumber(match[1]!)
}

const roundKg = (kg: number) => Math.round(kg * 10000) / 10000

export function evaluateLine(line: ReviewLine): LineEval {
  const issues: LineIssue[] = []
  const origins: Record<string, FieldOrigin> = {}
  const add = (field: string, kind: IssueKind, message: string) => issues.push({ field, kind, message })
  const numbersOk = line.confirmed.includes("numbers")

  for (const issue of line.rowIssues) add(issue.field, "invalid", issue.message)

  // Name: the description, or the mark when there is no description (as the spreadsheet import does).
  const name = line.name.trim() || line.sku.trim()
  if (!name) add("name", "missing", "Add a description or a mark for this line.")
  origins.name = originOf(line, "name")

  // Sizes.
  const sizes: (number | null)[] = []
  let sizeUnitNeeded = false
  for (const field of SIZE_FIELDS) {
    origins[field] = originOf(line, field)
    const text = line[field]
    const read = readSize(text, line.sizeUnit)
    if (!read.ok) {
      add(field, read.reason === "Missing." ? "missing" : "invalid", read.reason === "Missing." ? `Missing ${field}.` : `${capital(field)}: ${read.reason}`)
      sizes.push(null)
      continue
    }
    if (read.needsUnit) {
      sizeUnitNeeded = true
      sizes.push(null)
      continue
    }
    if (read.cm <= 0) {
      add(field, "invalid", `${capital(field)} must be greater than zero.`)
      sizes.push(null)
      continue
    }
    const number = /^[\d.,'’\s]+$/.test(text.trim()) ? readNumber(text) : null
    if (number?.ambiguous && !numbersOk) add(field, "ambiguous", `${capital(field)} “${text.trim()}” could mean ${number.value} or a decimal. Check the separator.`)
    sizes.push(read.cm)
  }
  if (sizeUnitNeeded) add("sizeUnit", "ambiguous", "The size unit is not stated in the document. Choose mm, cm, m, in or ft.")
  const sizesCm = sizes.every((value): value is number => value !== null) ? ([sizes[0]!, sizes[1]!, sizes[2]!] as [number, number, number]) : null

  // Quantity.
  origins.quantity = originOf(line, "quantity")
  let pieces: number | null = null
  if (line.quantity.trim() === "") {
    add("quantity", "missing", "Missing quantity.")
  } else {
    const count = readCount(line.quantity)
    if (count && count.ambiguous && !Number.isInteger(count.value) && !numbersOk) {
      // 1.200 read the English way is 1.2, which cannot be a count; in many countries it is twelve hundred.
      add("quantity", "ambiguous", `Quantity “${line.quantity.trim()}” could be ${count.value} or ${Math.round(count.value * 1000)}. Type the whole number.`)
    } else if (!count || !Number.isInteger(count.value) || count.value < 1) {
      add("quantity", "invalid", "Quantity must be a whole number of 1 or more.")
    } else {
      pieces = count.value
      if (count.ambiguous && !numbersOk) add("quantity", "ambiguous", `Quantity “${line.quantity.trim()}” could mean ${count.value} or a decimal. Check the separator.`)
    }
  }

  // Weight.
  origins.weight = originOf(line, "weight")
  let perPieceKg: number | null = null
  let lineKg: number | null = null
  let interpretation: string | null = null
  if (line.weight.trim() === "") {
    add("weight", "missing", "Missing weight.")
  } else {
    const parsed = parseWeight(line.weight, line.weightUnit)
    if (!parsed.ok) {
      const needsUnit = parsed.reason.startsWith("The weight unit is not stated")
      add(needsUnit ? "weightUnit" : "weight", needsUnit ? "ambiguous" : "invalid", parsed.reason)
    } else if (parsed.kg <= 0) {
      add("weight", "invalid", "Weight must be greater than zero.")
    } else {
      if (parsed.ambiguousNumber && !numbersOk) add("weight", "ambiguous", `Weight “${line.weight.trim()}” could mean ${parsed.kg} kg or a decimal. Check the separator.`)
      if (line.weightKind === "net" && !line.confirmed.includes("net")) {
        add("weight", "confirm", "This is a net weight. Load planning needs the gross weight with packing. Use a gross weight, or confirm the net weight.")
      }
      if (line.weightScope === "unclear") {
        add("weightScope", "ambiguous", "The document does not say whether this weight is for one piece or the whole line. Choose which.")
      } else if (line.weightScope === "piece") {
        perPieceKg = parsed.kg
        lineKg = pieces === null ? null : roundKg(parsed.kg * pieces)
      } else if (pieces === null) {
        lineKg = parsed.kg
        add("weight", "missing", "The weight is a line total, so the quantity is needed to find the weight per piece.")
      } else {
        lineKg = parsed.kg
        perPieceKg = roundKg(parsed.kg / pieces)
        origins.weight = "calculated"
        interpretation = `Line total ${trimNumber(parsed.kg)} kg ÷ ${pieces} piece${pieces === 1 ? "" : "s"} = ${trimNumber(perPieceKg)} kg per piece`
        if (!line.confirmed.includes("weight")) add("weight", "confirm", `${interpretation}. Confirm this reading, or switch the weight to per piece.`)
      }
    }
  }

  // Stop, clearance.
  let destinationStop = 1
  if (line.destination.trim() !== "") {
    const stop = readNumber(line.destination)
    if (!stop || !Number.isInteger(stop.value) || stop.value < 1) add("destination", "invalid", "The unloading stop must be a whole number of 1 or more.")
    else destinationStop = stop.value
  }
  let clearanceCm: number | null = null
  if (line.clearance.trim() !== "") {
    const clearance = readNumber(line.clearance)
    if (!clearance || clearance.value < 0 || clearance.value > 100) add("clearance", "invalid", "Clearance must be between 0 and 100 cm.")
    else clearanceCm = clearance.value
  }

  const volumeM3 = sizesCm && pieces !== null ? (sizesCm[0] * sizesCm[1] * sizesCm[2] * pieces) / 1_000_000 : null

  const blocking = issues.length > 0
  let input: CargoItemInput | null = null
  if (!blocking && sizesCm && pieces !== null && perPieceKg !== null) {
    const base = cargoPreset(line.shape)
    input = {
      ...base,
      sku: line.sku.trim() ? line.sku.trim().slice(0, 80) : null,
      name: name.slice(0, 120),
      lengthCm: sizesCm[0],
      widthCm: sizesCm[1],
      heightCm: sizesCm[2],
      weightKg: perPieceKg,
      quantity: pieces,
      stackable: line.stackable ?? base.stackable,
      bottomOnly: line.floorOnly ?? base.bottomOnly,
      orientation: line.orientation ?? base.orientation,
      destinationStop,
      consignmentId: line.consignment.trim() || null,
      segregationClass: line.hazard.trim() || null,
      ...(clearanceCm === null ? {} : { clearanceCm }),
      ...line.extras,
    }
  }

  let status: LineStatus
  if (!line.include) status = "excluded"
  else if (issues.some((issue) => issue.kind === "invalid")) status = "invalid"
  else if (issues.some((issue) => issue.kind === "missing")) status = "missing"
  else if (issues.length > 0) status = "ambiguous"
  else status = line.edited.length > 0 ? "corrected" : "ready"

  return { status, issues, input, pieces, perPieceKg, lineKg, volumeM3, sizesCm, interpretation, origins }
}

/** A line can be saved only when it is included and nothing is missing, unclear or invalid. */
export function isImportable(evaluation: LineEval): boolean {
  return (evaluation.status === "ready" || evaluation.status === "corrected") && evaluation.input !== null
}

export type ReviewSummary = {
  detected: number
  included: number
  importable: number
  needReview: number
  pieces: number
  weightKg: number
  volumeM3: number
  /** True when some included line lacks a quantity, weight or size, so the totals above leave it out. */
  incomplete: boolean
}

export function summarize(lines: ReviewLine[], evaluations: LineEval[]): ReviewSummary {
  const summary: ReviewSummary = { detected: lines.length, included: 0, importable: 0, needReview: 0, pieces: 0, weightKg: 0, volumeM3: 0, incomplete: false }
  lines.forEach((line, index) => {
    const evaluation = evaluations[index]!
    if (!line.include) return
    summary.included += 1
    if (isImportable(evaluation)) summary.importable += 1
    else summary.needReview += 1
    if (evaluation.pieces !== null) summary.pieces += evaluation.pieces
    if (evaluation.lineKg !== null && evaluation.perPieceKg !== null) summary.weightKg += evaluation.lineKg
    if (evaluation.volumeM3 !== null) summary.volumeM3 += evaluation.volumeM3
    if (evaluation.pieces === null || evaluation.perPieceKg === null || evaluation.volumeM3 === null) summary.incomplete = true
  })
  summary.weightKg = roundKg(summary.weightKg)
  return summary
}

export type ExistingCargoSummary = { sku: string | null; name: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number }

const norm = (text: string | null) => (text ?? "").trim().toLowerCase().replace(/\s+/g, " ")
const r1 = (value: number) => Math.round(value * 10) / 10
const sameSize = (a: number, b: number) => Math.abs(a - b) < 0.05

/**
 * Lines that look like each other, or like cargo already in the project. This only informs: repeated
 * lines are normal (several crates of one SKU) and are never removed or merged.
 */
export function findDuplicates(lines: ReviewLine[], evaluations: LineEval[], existing: ExistingCargoSummary[]): Map<string, string[]> {
  const notes = new Map<string, string[]>()
  const push = (id: string, message: string) => notes.set(id, [...(notes.get(id) ?? []), message])
  const keys = new Map<string, number[]>()
  const sources = new Map<string, number[]>()

  lines.forEach((line, index) => {
    const evaluation = evaluations[index]!
    if (evaluation.sizesCm && evaluation.perPieceKg !== null) {
      const key = [norm(line.sku), norm(line.name), ...evaluation.sizesCm.map(r1), r1(evaluation.perPieceKg)].join("|")
      keys.set(key, [...(keys.get(key) ?? []), index])
    }
    const { sheet, row, page } = line.source
    if (row !== undefined || page !== undefined) {
      const key = `${sheet ?? ""}|${page ?? ""}|${row ?? ""}|${norm(line.sku)}|${norm(line.name)}`
      sources.set(key, [...(sources.get(key) ?? []), index])
    }
    if (evaluation.sizesCm && evaluation.perPieceKg !== null) {
      const match = existing.find(
        (cargo) =>
          norm(cargo.sku) === norm(line.sku) &&
          norm(cargo.name) === norm(line.name) &&
          sameSize(cargo.lengthCm, evaluation.sizesCm![0]) &&
          sameSize(cargo.widthCm, evaluation.sizesCm![1]) &&
          sameSize(cargo.heightCm, evaluation.sizesCm![2]) &&
          sameSize(cargo.weightKg, evaluation.perPieceKg!),
      )
      if (match) push(line.id, "The project already has a line with the same mark, name, size and weight. Importing adds another one.")
    }
  })
  for (const indexes of keys.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      const others = indexes.filter((other) => other !== index).map((other) => other + 1)
      push(lines[index]!.id, `Same mark, name, size and weight as line ${others.join(", ")} of this import. Repeated lines are kept; check it is not a double count.`)
    }
  }
  for (const indexes of sources.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) push(lines[index]!.id, "This source row was read more than once, which can happen when pages overlap. Exclude the copy if it is a repeat.")
  }
  return notes
}

export type DocumentTotals = { pieces: number | null; weightKg: number | null }

/** Differences between what the lines add up to and the totals the document states. Both are shown; neither is changed. */
export function compareTotals(summary: ReviewSummary, totals: DocumentTotals | null): string[] {
  if (!totals) return []
  const notes: string[] = []
  if (totals.pieces !== null && summary.pieces !== totals.pieces) {
    notes.push(`The document states ${totals.pieces} pieces in total; the lines add up to ${summary.pieces}.`)
  }
  if (totals.weightKg !== null && Math.abs(summary.weightKg - totals.weightKg) > Math.max(0.5, totals.weightKg * 0.005)) {
    notes.push(`The document states ${trimNumber(totals.weightKg)} kg in total; the lines add up to ${trimNumber(summary.weightKg)} kg.`)
  }
  return notes
}

/** Where a line says it came from, for the review table ("Sheet1 row 7", "page 2"). */
export function describeSource(source: ReviewSource): string {
  const parts: string[] = []
  if (source.sheet) parts.push(source.sheet)
  if (source.page !== undefined) parts.push(`page ${source.page}`)
  if (source.row !== undefined) parts.push(`row ${source.row}`)
  if (source.cells) parts.push(source.cells)
  return parts.join(" · ")
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function trimNumber(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}
