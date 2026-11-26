import type { CargoItemInput, CargoShape, Orientation } from "@compass/domain"
import { cargoPreset } from "@/lib/cargo-defaults"
import { displayLengthText, type LengthUnit } from "@/lib/cargo-units"
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

/** Where a value came from: the document as written, worked out from it, an estimate to confirm, or typed by the planner. */
export type FieldOrigin = "source" | "calculated" | "estimated" | "user"

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
export type Confirmation = "weight" | "numbers" | "net" | "estimate"

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
  /** The weight used for planning, as written: the gross weight (with packaging) when the document gives one. */
  weight: string
  /** A net weight, kept as reference. It never replaces the planning weight. */
  netWeight: string
  /** The words in the document that say whether the weight is per package or for the line (a column title or a quote). */
  weightEvidence: string
  /** An estimated weight per piece in kg, offered when the document gives no weight for this line (an equal share of a total). Used only while `weight` is blank. */
  estimatedWeight: string
  /** How the estimate was made, in words. */
  estimateBasis: string
  /** The kind of package as written (wooden case, pallet, carton). */
  packageType: string
  /** How many products are inside the package(s), as written (250 pcs). Not the number of packages. */
  contentsQuantity: string
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
  source: ReviewSource
  /** Things the import did on its own that are worth knowing, such as a unit taken from the table heading. They never block a line. */
  infoNotes: string[]
  /** The values exactly as first read, before any edit, for the details view. */
  original: Record<string, string>
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
    netWeight: "",
    weightEvidence: "",
    estimatedWeight: "",
    estimateBasis: "",
    packageType: "",
    contentsQuantity: "",
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
    source: {},
    infoNotes: [],
    original: {},
    modelNotes: [],
    checks: [],
    edited: [],
    confirmed: [],
    rowIssues: [],
    extras: {},
  }
}

/** Remembers what was first read, so the details can show it next to what the planner has changed it to. */
export function withOriginal(line: ReviewLine): ReviewLine {
  const original: Record<string, string> = {}
  for (const field of ["sku", "name", "length", "width", "height", "quantity", "weight", "netWeight"] as const) original[field] = line[field]
  if (line.sizeUnit) original.sizeUnit = line.sizeUnit
  if (line.weightUnit) original.weightUnit = line.weightUnit
  original.weightScope = line.weightScope
  original.weightKind = line.weightKind
  return { ...line, original }
}

export type IssueKind = "missing" | "ambiguous" | "invalid" | "confirm"

/** What went wrong, in a form the warnings box can group by. One code is one kind of problem across many rows. */
export type IssueCode =
  | "name-missing"
  | "size-missing"
  | "size-invalid"
  | "size-unit"
  | "number-format"
  | "qty-missing"
  | "qty-invalid"
  | "weight-missing"
  | "weight-invalid"
  | "weight-unit"
  | "weight-scope"
  | "weight-needs-qty"
  | "net-only"
  | "net-gt-gross"
  | "row-issue"
  | "stop-invalid"

export type LineIssue = { field: string; kind: IssueKind; code: IssueCode; message: string }

/** Things worth knowing that never block a line: a conversion that worked, a weight worked out, a net weight kept for reference. */
export type NoteCode = "unit-converted" | "weight-calculated" | "weight-estimated" | "net-reference" | "source-note"
export type LineNote = { code: NoteCode; message: string }

export type LineStatus = "ready" | "corrected" | "estimated" | "missing" | "ambiguous" | "invalid" | "excluded"

export const STATUS_LABEL: Record<LineStatus, string> = {
  ready: "Ready for review",
  corrected: "User corrected",
  estimated: "Estimated weight: confirm before calculating a load plan",
  missing: "Missing required information",
  ambiguous: "Ambiguous value",
  invalid: "Invalid value",
  excluded: "Excluded from import",
}

/** The same states in one or two words, for the narrow status column of the review table. */
export const STATUS_SHORT: Record<LineStatus, string> = {
  ready: "OK",
  corrected: "Edited",
  estimated: "Estimate",
  missing: "Missing",
  ambiguous: "Check",
  invalid: "Invalid",
  excluded: "Excluded",
}

export type LineEval = {
  status: LineStatus
  issues: LineIssue[]
  /** Informational notes. They never block a line. */
  notes: LineNote[]
  /** The cargo line this would create. Null while anything blocks it. */
  input: CargoItemInput | null
  pieces: number | null
  /** The weight per piece used for planning, when it can be worked out. */
  perPieceKg: number | null
  lineKg: number | null
  /** True when the planning weight is settled: nothing about its unit, meaning or format is open. Totals only count settled weights. */
  weightResolved: boolean
  /** True while the planning weight is an estimate the planner has not confirmed. Fine for a provisional equipment suggestion, not for a final load plan. */
  weightEstimated: boolean
  /** True when the document says nothing about stacking. The line is then planned as not stackable, and shown as not stated. */
  stackableNotStated: boolean
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
  const notes: LineNote[] = []
  const origins: Record<string, FieldOrigin> = {}
  const add = (field: string, kind: IssueKind, code: IssueCode, message: string) => issues.push({ field, kind, code, message })
  const numbersOk = line.confirmed.includes("numbers")

  for (const issue of line.rowIssues) add(issue.field, "invalid", "row-issue", issue.message)
  for (const message of line.infoNotes) notes.push({ code: "source-note", message })

  // Name: the description, or the mark when there is no description (as the spreadsheet import does).
  const name = line.name.trim() || line.sku.trim()
  if (!name) add("name", "missing", "name-missing", "Add a description or a mark for this line.")
  origins.name = originOf(line, "name")

  // Sizes. Each one is kept as it was written; the unit decides what it means.
  const sizes: (number | null)[] = []
  let sizeUnitNeeded = false
  for (const field of SIZE_FIELDS) {
    origins[field] = originOf(line, field)
    const text = line[field]
    const read = readSize(text, line.sizeUnit)
    if (!read.ok) {
      const missing = read.reason === "Missing."
      add(field, missing ? "missing" : "invalid", missing ? "size-missing" : "size-invalid", missing ? `Missing ${field}.` : `${capital(field)}: ${read.reason}`)
      sizes.push(null)
      continue
    }
    if (read.needsUnit) {
      sizeUnitNeeded = true
      sizes.push(null)
      continue
    }
    if (read.cm <= 0) {
      add(field, "invalid", "size-invalid", `${capital(field)} must be greater than zero.`)
      sizes.push(null)
      continue
    }
    const number = /^[\d.,'’\s]+$/.test(text.trim()) ? readNumber(text) : null
    if (number?.ambiguous && !numbersOk) add(field, "ambiguous", "number-format", `${capital(field)} “${text.trim()}” could mean ${number.value} or a decimal. Check the separator.`)
    sizes.push(read.cm)
  }
  if (sizeUnitNeeded) {
    add("sizeUnit", "ambiguous", "size-unit", "The size unit is not stated. The numbers are kept as written: choose mm, cm, m, in or ft.")
    for (const field of SIZE_FIELDS) if (!issues.some((issue) => issue.field === field)) add(field, "ambiguous", "size-unit", "Unit not stated: confirm it.")
  }
  const sizesCm = sizes.every((value): value is number => value !== null) ? ([sizes[0]!, sizes[1]!, sizes[2]!] as [number, number, number]) : null
  if (sizesCm && line.sizeUnit && line.sizeUnit !== "cm") {
    notes.push({ code: "unit-converted", message: `Sizes converted from ${line.sizeUnit} to cm.` })
  }

  // Quantity.
  origins.quantity = originOf(line, "quantity")
  let pieces: number | null = null
  if (line.quantity.trim() === "") {
    add("quantity", "missing", "qty-missing", "Missing quantity.")
  } else {
    const count = readCount(line.quantity)
    if (count && count.ambiguous && !Number.isInteger(count.value) && !numbersOk) {
      // 1.200 read the English way is 1.2, which cannot be a count; in many countries it is twelve hundred.
      add("quantity", "ambiguous", "number-format", `Quantity “${line.quantity.trim()}” could be ${count.value} or ${Math.round(count.value * 1000)}. Type the whole number.`)
    } else if (!count || !Number.isInteger(count.value) || count.value < 1) {
      add("quantity", "invalid", "qty-invalid", "Quantity must be a whole number of 1 or more.")
    } else {
      pieces = count.value
      if (count.ambiguous && !numbersOk) add("quantity", "ambiguous", "number-format", `Quantity “${line.quantity.trim()}” could mean ${count.value} or a decimal. Check the separator.`)
    }
  }

  // Weight. The planning weight is the gross weight (with packaging) when the document gives one.
  origins.weight = originOf(line, "weight")
  let perPieceKg: number | null = null
  let lineKg: number | null = null
  let interpretation: string | null = null
  let planningKg: number | null = null
  const estimate = line.weight.trim() === "" && line.estimatedWeight.trim() !== "" ? parseWeight(line.estimatedWeight, "kg") : null
  let weightEstimated = false
  if (estimate && estimate.ok && estimate.kg > 0) {
    perPieceKg = estimate.kg
    lineKg = pieces === null ? null : roundKg(estimate.kg * pieces)
    if (line.confirmed.includes("estimate")) {
      origins.weight = "user"
    } else {
      origins.weight = "estimated"
      weightEstimated = true
      notes.push({ code: "weight-estimated", message: `Estimated ${trimNumber(estimate.kg)} kg per piece (${line.estimateBasis || "an equal share of a total"}). Confirm it before calculating a load plan.` })
    }
  } else if (line.weight.trim() === "") {
    add("weight", "missing", "weight-missing", "Missing weight.")
  } else {
    const parsed = parseWeight(line.weight, line.weightUnit)
    if (!parsed.ok) {
      const needsUnit = parsed.reason.startsWith("The weight unit is not stated")
      add(needsUnit ? "weightUnit" : "weight", needsUnit ? "ambiguous" : "invalid", needsUnit ? "weight-unit" : "weight-invalid", needsUnit ? `${parsed.reason} The number is kept as written.` : parsed.reason)
    } else if (parsed.kg <= 0) {
      add("weight", "invalid", "weight-invalid", "Weight must be greater than zero.")
    } else {
      planningKg = parsed.kg
      if (parsed.ambiguousNumber && !numbersOk) add("weight", "ambiguous", "number-format", `Weight “${line.weight.trim()}” could mean ${parsed.kg} kg or a decimal. Check the separator.`)
      if (line.weightKind === "net" && !line.confirmed.includes("net")) {
        add("weight", "confirm", "net-only", "Only a net weight is given. Planning needs the gross weight with packaging. Enter the gross weight, or confirm using the net weight.")
      }
      if (pieces === 1) {
        // One piece: the weight of the piece and of the line are the same, so what the document meant makes no difference.
        perPieceKg = parsed.kg
        lineKg = parsed.kg
      } else if (line.weightScope === "piece") {
        perPieceKg = parsed.kg
        lineKg = pieces === null ? null : roundKg(parsed.kg * pieces)
      } else if (line.weightScope === "line") {
        lineKg = parsed.kg
        if (pieces === null) {
          add("weight", "missing", "weight-needs-qty", "The weight is a line total, so the quantity is needed to find the weight per piece.")
        } else {
          perPieceKg = roundKg(parsed.kg / pieces)
          origins.weight = "calculated"
          interpretation = `Line total ${trimNumber(parsed.kg)} kg ÷ ${pieces} pieces = ${trimNumber(perPieceKg)} kg per piece`
          notes.push({ code: "weight-calculated", message: `${interpretation}.` })
        }
      } else if (pieces !== null) {
        // Quantity above 1 and nothing says whether the weight is for one package or for the lot. The number is kept and never assumed.
        add("weightScope", "ambiguous", "weight-scope", `Quantity is ${pieces}. Is ${trimNumber(parsed.kg)} kg for each piece or for the whole line? Choose which.`)
      }
    }
  }
  const weightResolved = perPieceKg !== null && !issues.some((issue) => issue.field === "weight" || issue.field === "weightScope" || issue.field === "weightUnit")

  // The net weight is kept for reference. It never replaces the gross weight, and it is checked against it.
  if (line.netWeight.trim() !== "") {
    const net = parseWeight(line.netWeight, line.weightUnit)
    if (net.ok) {
      if (line.weightKind !== "net") {
        notes.push({ code: "net-reference", message: `Net weight ${trimNumber(net.kg)} kg is kept as reference. Planning uses the weight with packaging.` })
        // Only while the weight is still the one the document gave: a weight the planner typed is theirs, and the net weight no longer sits on the same basis.
        if (planningKg !== null && net.kg > planningKg + 0.0001 && !line.edited.includes("weight")) {
          add("weight", "confirm", "net-gt-gross", `The net weight (${trimNumber(net.kg)} kg) is higher than the gross weight (${trimNumber(planningKg)} kg). Check both.`)
        }
      }
    } else {
      notes.push({ code: "net-reference", message: `The net weight “${line.netWeight.trim()}” could not be read and is kept as written.` })
    }
  }

  // Unloading stop.
  let destinationStop = 1
  if (line.destination.trim() !== "") {
    const stop = readNumber(line.destination)
    if (!stop || !Number.isInteger(stop.value) || stop.value < 1) add("destination", "invalid", "stop-invalid", "The unloading stop must be a whole number of 1 or more.")
    else destinationStop = stop.value
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
      // Never assumed: a document that says nothing about stacking is planned as not stackable.
      stackable: line.stackable ?? false,
      bottomOnly: line.floorOnly ?? base.bottomOnly,
      orientation: line.orientation ?? base.orientation,
      destinationStop,
      consignmentId: line.consignment.trim() || null,
      segregationClass: line.hazard.trim() || null,
      ...line.extras,
    }
  }

  let status: LineStatus
  if (!line.include) status = "excluded"
  else if (issues.some((issue) => issue.kind === "invalid")) status = "invalid"
  else if (issues.some((issue) => issue.kind === "missing")) status = "missing"
  else if (issues.length > 0) status = "ambiguous"
  else if (weightEstimated) status = "estimated"
  else status = line.edited.length > 0 ? "corrected" : "ready"

  return { status, issues, notes, input, pieces, perPieceKg, lineKg, weightResolved, weightEstimated, stackableNotStated: line.stackable === null, volumeM3, sizesCm, interpretation, origins }
}

/** A line can be saved as ready cargo only when it is included and nothing is missing, unclear or invalid. */
export function isImportable(evaluation: LineEval): boolean {
  // An estimated weight is good enough to add the line and suggest equipment; it is confirmed before a load plan is calculated.
  return (evaluation.status === "ready" || evaluation.status === "corrected" || evaluation.status === "estimated") && evaluation.input !== null
}

/**
 * What an incomplete line can safely become: a draft cargo line. Values that are settled are kept; a
 * value that is not (a size with no unit, a weight that could mean two things) is left at 0, which the
 * Cargo grid shows as missing and which keeps the line out of equipment suggestions and load plans,
 * and the numbers as written go into notes stored with the line so nothing the document said is lost.
 * Returns null when there is not even a quantity and a name to build a line on.
 */
export function toDraft(line: ReviewLine, evaluation: LineEval): { input: CargoItemInput; notes: string[] } | null {
  const name = line.name.trim() || line.sku.trim()
  if (evaluation.pieces === null || !name) return null
  const base = cargoPreset(line.shape)
  const size = (field: (typeof SIZE_FIELDS)[number]) => {
    const read = readSize(line[field], line.sizeUnit)
    return read.ok && read.cm !== null && read.cm > 0 ? read.cm : 0
  }
  const sizesKnown = evaluation.sizesCm !== null
  const [length, width, height] = sizesKnown ? evaluation.sizesCm! : [size("length"), size("width"), size("height")]
  const weight = evaluation.weightResolved && evaluation.perPieceKg !== null ? evaluation.perPieceKg : 0

  const written: string[] = []
  if (!sizesKnown && (line.length || line.width || line.height)) {
    const unit = line.sizeUnit ? ` ${line.sizeUnit}` : " (unit not stated)"
    written.push(`Size as written: ${[line.length, line.width, line.height].map((part) => part.trim() || "?").join(" × ")}${unit}.`)
  }
  if (weight === 0 && line.weight.trim()) {
    const unit = line.weightUnit ? ` ${line.weightUnit}` : ""
    const scope = line.weightScope === "line" ? " for the line" : line.weightScope === "piece" ? " per piece" : " (per piece or for the line not stated)"
    written.push(`Weight as written: ${line.weight.trim()}${unit}${scope}.`)
  }
  if (line.netWeight.trim()) written.push(`Net weight as written: ${line.netWeight.trim()}.`)
  const blockers = evaluation.issues.filter((issue) => issue.kind !== "confirm" || issue.code !== "net-gt-gross").map((issue) => issue.message)
  const notes = [...new Set([...written, ...blockers])].map((text) => text.slice(0, 300)).slice(0, 8)

  return {
    input: {
      ...base,
      sku: line.sku.trim() ? line.sku.trim().slice(0, 80) : null,
      name: name.slice(0, 120),
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      weightKg: weight,
      quantity: evaluation.pieces,
      // Never assumed: a document that says nothing about stacking is planned as not stackable.
      stackable: line.stackable ?? false,
      bottomOnly: line.floorOnly ?? base.bottomOnly,
      orientation: line.orientation ?? base.orientation,
      destinationStop: readNumber(line.destination)?.value && Number.isInteger(readNumber(line.destination)!.value) && readNumber(line.destination)!.value >= 1 ? readNumber(line.destination)!.value : 1,
      consignmentId: line.consignment.trim() || null,
      segregationClass: line.hazard.trim() || null,
      ...line.extras,
    },
    notes,
  }
}

export type ReviewSummary = {
  detected: number
  included: number
  /** Selected lines that are complete and clear. */
  importable: number
  /** Selected lines with something to fix or confirm. */
  needReview: number
  /** Pieces counted from every selected line whose quantity is known, whatever else is missing. */
  pieces: number
  piecesUnknownLines: number
  /** Weight of the lines whose weight is settled. */
  weightKg: number
  weightUnresolvedLines: number
  /** Volume of the lines whose sizes and quantity are known. */
  volumeM3: number
  volumeUnresolvedLines: number
  /** Selected lines whose weight is an unconfirmed estimate. Their weight is in the total, which is then an estimate too. */
  estimatedWeightLines: number
  /** True when any total leaves a selected line out. */
  incomplete: boolean
}

export function summarize(lines: ReviewLine[], evaluations: LineEval[]): ReviewSummary {
  const summary: ReviewSummary = {
    detected: lines.length,
    included: 0,
    importable: 0,
    needReview: 0,
    pieces: 0,
    piecesUnknownLines: 0,
    weightKg: 0,
    weightUnresolvedLines: 0,
    volumeM3: 0,
    volumeUnresolvedLines: 0,
    estimatedWeightLines: 0,
    incomplete: false,
  }
  lines.forEach((line, index) => {
    const evaluation = evaluations[index]!
    if (!line.include) return
    summary.included += 1
    if (isImportable(evaluation)) summary.importable += 1
    else summary.needReview += 1
    if (evaluation.pieces !== null) summary.pieces += evaluation.pieces
    else summary.piecesUnknownLines += 1
    if (evaluation.weightEstimated) summary.estimatedWeightLines += 1
    if (evaluation.weightResolved && evaluation.lineKg !== null) summary.weightKg += evaluation.lineKg
    else summary.weightUnresolvedLines += 1
    if (evaluation.volumeM3 !== null) summary.volumeM3 += evaluation.volumeM3
    else summary.volumeUnresolvedLines += 1
  })
  summary.weightKg = roundKg(summary.weightKg)
  summary.incomplete = summary.piecesUnknownLines + summary.weightUnresolvedLines + summary.volumeUnresolvedLines > 0
  return summary
}

// ---- one warnings box for the whole table ----------------------------------------------------------

export type IssueGroup = {
  key: string
  /** One short sentence for the whole group. The exact wording for a row is in that row's cell. */
  message: string
  /** Line numbers, 1 based, of the selected lines the group applies to. */
  rows: number[]
}

export type ConsolidatedIssues = {
  /** Invalid or missing required information: the lines cannot be planned until it is entered. */
  required: IssueGroup[]
  /** Values that need the planner to choose or confirm. */
  confirm: IssueGroup[]
  /** Notes that need no action. */
  info: IssueGroup[]
}

const GROUP_TEXT: Record<IssueCode, string> = {
  "name-missing": "A description or mark is missing",
  "size-missing": "A length, width or height is missing",
  "size-invalid": "A size cannot be read, or is zero",
  "size-unit": "The size unit is not stated (the numbers are kept: choose the unit)",
  "number-format": "A number is written in a way that can be read two ways",
  "qty-missing": "The quantity is missing",
  "qty-invalid": "The quantity is not a whole number of 1 or more",
  "weight-missing": "The weight is missing",
  "weight-invalid": "A weight cannot be read, or is zero",
  "weight-unit": "The weight unit is not stated",
  "weight-scope": "The weight could be for each piece or for the whole line (quantity above 1)",
  "weight-needs-qty": "A line total weight needs a quantity",
  "net-only": "Only a net weight is given (planning needs gross, with packaging)",
  "net-gt-gross": "A net weight is higher than the gross weight",
  "row-issue": "A value in the source row is not allowed",
  "stop-invalid": "The unloading stop is not a whole number",
}

const NOTE_TEXT: Record<Exclude<NoteCode, "source-note" | "unit-converted">, string> = {
  "weight-calculated": "Weight per piece worked out from a line total and the quantity",
  "net-reference": "Net weight kept as reference; planning uses the weight with packaging",
  "weight-estimated": "Estimated weights (equal shares of a total): confirm them before calculating a load plan",
}

const REQUIRED_KINDS: IssueKind[] = ["missing", "invalid"]

/** Folds every selected line's problems into a few short, grouped warnings, instead of one repeated message per row. */
export function consolidateIssues(lines: ReviewLine[], evaluations: LineEval[]): ConsolidatedIssues {
  const required = new Map<string, IssueGroup>()
  const confirm = new Map<string, IssueGroup>()
  const info = new Map<string, IssueGroup>()
  const put = (map: Map<string, IssueGroup>, key: string, message: string, row: number) => {
    const group = map.get(key) ?? { key, message, rows: [] }
    if (!group.rows.includes(row)) group.rows.push(row)
    map.set(key, group)
  }
  lines.forEach((line, index) => {
    if (!line.include) return
    const evaluation = evaluations[index]!
    for (const issue of evaluation.issues) {
      put(REQUIRED_KINDS.includes(issue.kind) ? required : confirm, issue.code, GROUP_TEXT[issue.code], index + 1)
    }
    for (const note of evaluation.notes) {
      if (note.code === "weight-estimated") put(confirm, note.code, NOTE_TEXT[note.code], index + 1)
      else if (note.code === "source-note" || note.code === "unit-converted") put(info, `${note.code}:${note.message}`, note.message.replace(/\.$/, ""), index + 1)
      else put(info, note.code, NOTE_TEXT[note.code], index + 1)
    }
  })
  return { required: [...required.values()], confirm: [...confirm.values()], info: [...info.values()] }
}

/** "rows 3, 5 and 9", or "rows 2 to 40" for a long run, for the warnings box. */
export function describeRows(rows: number[]): string {
  const sorted = [...rows].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]!
  let previous = start
  for (const row of [...sorted.slice(1), Number.POSITIVE_INFINITY]) {
    if (row === previous + 1) {
      previous = row
      continue
    }
    parts.push(previous - start >= 2 ? `${start} to ${previous}` : start === previous ? `${start}` : `${start}, ${previous}`)
    start = row
    previous = row
  }
  const text = parts.join(", ")
  return `${sorted.length === 1 ? "row" : "rows"} ${text}`
}

/** A size as the review table shows it: in the display unit when the unit is known, otherwise exactly as it was written. */
export function displayDimension(line: ReviewLine, field: (typeof SIZE_FIELDS)[number], unit: LengthUnit): { text: string; converted: boolean } {
  const written = line[field].trim()
  const read = readSize(written, line.sizeUnit)
  if (read.ok && read.cm !== null && read.cm > 0) return { text: displayLengthText(read.cm, unit), converted: true }
  return { text: written, converted: false }
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

/** What the document itself states for the whole shipment. `weightKg` is the gross weight. */
export type DocumentTotals = {
  pieces: number | null
  weightKg: number | null
  netKg?: number | null
  /** The quantity of products, as written (1,500 pcs), as opposed to the number of packages. */
  productQuantity?: string | null
  volumeM3?: number | null
}

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

// ---- estimated weights ----------------------------------------------------------------------------------

export type WeightSuggestion = {
  /** Line id to estimated kg per piece. */
  estimates: Map<string, string>
  /** The total that is shared out. */
  sharedKg: number
  pieces: number
  basis: string
  /** True when every package that gets a share has the same size, which is when an equal share is most reasonable. */
  sameSize: boolean
  /** What rounding to 0.01 kg could not place, in kg. Zero when the shares add up exactly. */
  residualKg: number
}

/**
 * Shares `totalKg` out over `pieces` packages in hundredths of a kilogram so the parts add back up to the
 * total exactly. A line of several pieces needs the same weight for each of them, so the hundredths
 * left over go to lines with fewer pieces first; anything that still cannot be placed is reported.
 */
function shareOut(totalKg: number, lines: { id: string; pieces: number }[]): { perPiece: Map<string, number>; residualKg: number } {
  const totalHundredths = Math.round(totalKg * 100)
  const pieces = lines.reduce((sum, entry) => sum + entry.pieces, 0)
  const base = Math.floor(totalHundredths / pieces)
  let left = totalHundredths - base * pieces
  const perPiece = new Map(lines.map((entry) => [entry.id, base]))
  for (const entry of [...lines].sort((a, b) => a.pieces - b.pieces)) {
    if (left >= entry.pieces) {
      perPiece.set(entry.id, base + 1)
      left -= entry.pieces
    }
  }
  return { perPiece: new Map([...perPiece].map(([id, hundredths]) => [id, hundredths / 100])), residualKg: left / 100 }
}

/**
 * When the document gives a total gross weight but no weight for some packages, an equal share of what
 * is left (the total less the weights the other lines do give) for each of those packages. It is only a
 * suggestion: the planner applies it, it is shown as an estimate, and it is confirmed before a load plan.
 * Null when there is nothing to share, or when another line's weight is itself unsettled (the remainder
 * would then not be known).
 */
export function suggestWeightDistribution(lines: ReviewLine[], evaluations: LineEval[], totalGrossKg: number | null | undefined): WeightSuggestion | null {
  if (!totalGrossKg || !(totalGrossKg > 0)) return null
  const candidates: { id: string; pieces: number; sizes: [number, number, number] | null }[] = []
  let knownKg = 0
  for (const [index, line] of lines.entries()) {
    if (!line.include) continue
    const evaluation = evaluations[index]!
    if (line.weight.trim() === "") {
      if (evaluation.pieces === null) return null
      candidates.push({ id: line.id, pieces: evaluation.pieces, sizes: evaluation.sizesCm })
    } else if (evaluation.weightResolved && evaluation.lineKg !== null) {
      knownKg += evaluation.lineKg
    } else {
      return null
    }
  }
  if (candidates.length === 0) return null
  const sharedKg = roundKg(totalGrossKg - knownKg)
  if (!(sharedKg > 0)) return null
  const pieces = candidates.reduce((sum, entry) => sum + entry.pieces, 0)
  const { perPiece, residualKg } = shareOut(sharedKg, candidates)
  const first = candidates[0]!.sizes
  const sameSize = first !== null && candidates.every((entry) => entry.sizes !== null && entry.sizes.every((value, axis) => Math.abs(value - first[axis]!) < 0.05))
  const basis =
    knownKg > 0
      ? `equal share of ${trimNumber(sharedKg)} kg: the document's total gross weight of ${trimNumber(totalGrossKg)} kg less ${trimNumber(roundKg(knownKg))} kg given for other lines, over ${pieces} packages`
      : `equal share of the document's total gross weight of ${trimNumber(totalGrossKg)} kg over ${pieces} packages`
  return { estimates: new Map([...perPiece].map(([id, kg]) => [id, trimNumber(kg)])), sharedKg, pieces, basis, sameSize, residualKg }
}

/** Puts the suggested estimates on their lines. Any earlier acceptance of an estimate is taken back. */
export function applyWeightEstimates(lines: ReviewLine[], suggestion: WeightSuggestion): ReviewLine[] {
  return lines.map((line) => {
    const estimate = suggestion.estimates.get(line.id)
    if (estimate === undefined) return line
    return { ...line, estimatedWeight: estimate, estimateBasis: suggestion.basis, confirmed: line.confirmed.filter((entry) => entry !== "estimate") }
  })
}

/** Accepts the estimates on the given lines (all of them when no ids are given): they then count as the planner's own values. */
export function acceptWeightEstimates(lines: ReviewLine[], ids?: ReadonlySet<string>): ReviewLine[] {
  return lines.map((line) =>
    line.estimatedWeight && line.weight.trim() === "" && (!ids || ids.has(line.id)) && !line.confirmed.includes("estimate")
      ? { ...line, confirmed: [...line.confirmed, "estimate"], edited: [...new Set([...line.edited, "weight"])] }
      : line,
  )
}

export function clearWeightEstimates(lines: ReviewLine[]): ReviewLine[] {
  return lines.map((line) => (line.estimatedWeight ? { ...line, estimatedWeight: "", estimateBasis: "", confirmed: line.confirmed.filter((entry) => entry !== "estimate") } : line))
}

// ---- packages listed by a range of marks ------------------------------------------------------------------

const MARK_RANGE = /^\s*([A-Za-z]*[-\s#./]*)(\d+)\s*(?:-|–|~|to|through|thru)\s*(?:\1)?(\d+)\s*$/i

/**
 * "S-1 to S-6" on one line of six identical packages becomes six lines, S-1 to S-6, one package each,
 * so every box can be placed, labelled and checked on its own. It is only done when the quantity says
 * exactly that many packages. A weight per package is copied; a weight for the whole range is shared
 * out as an estimate to confirm; a weight that does not say which is left for the planner.
 */
export function expandMarkRange(line: ReviewLine): ReviewLine[] {
  const match = MARK_RANGE.exec(line.sku)
  if (!match) return [line]
  const [, prefix = "", fromText = "", toText = ""] = match
  const from = Number(fromText)
  const to = Number(toText)
  const count = to - from + 1
  const quantity = readCount(line.quantity)
  if (!(count >= 2 && count <= 500) || !quantity || quantity.value !== count) return [line]

  const width = fromText.length > 1 && fromText.startsWith("0") ? fromText.length : 0
  const marks = Array.from({ length: count }, (_, offset) => `${prefix}${String(from + offset).padStart(width, "0")}`)
  const listed = `Listed as ${line.sku.trim()} (${count} packages): one line per package.`
  const weight = line.weight.trim() ? parseWeight(line.weight, line.weightUnit) : null
  const shares = weight && weight.ok && line.weightScope === "line" ? shareOut(weight.kg, marks.map((mark) => ({ id: mark, pieces: 1 }))).perPiece : null

  return marks.map((mark, offset) => {
    const each: ReviewLine = { ...line, id: `${line.id}-${offset + 1}`, sku: mark, quantity: "1", infoNotes: [...line.infoNotes, listed], original: { ...line.original, sku: line.sku, quantity: line.quantity } }
    if (line.weight.trim() === "" || line.weightScope === "piece") return each
    if (shares) {
      return { ...each, weight: "", estimatedWeight: trimNumber(shares.get(mark)!), estimateBasis: `equal share of the ${trimNumber(weight!.ok ? weight!.kg : 0)} kg given for ${line.sku.trim()}` }
    }
    return { ...each, weight: "", checks: [...line.checks, `The weight ${line.weight.trim()} was given for ${line.sku.trim()} without saying whether it is per package or for all ${count}. Enter the weight of this package.`] }
  })
}

/**
 * Fills in the equal-share estimates straight away when that is the reasonable reading: the document gives a total
 * gross weight, the packages without a weight are all the same size, and no line carries an estimate yet. They are
 * still estimates (shown as such, confirmed before a load plan). Packages of different sizes are only offered the
 * split, because their real weights may differ a lot.
 */
export function withSuggestedEstimates(lines: ReviewLine[], totals: DocumentTotals | null | undefined): ReviewLine[] {
  if (lines.some((line) => line.estimatedWeight)) return lines
  const suggestion = suggestWeightDistribution(lines, lines.map(evaluateLine), totals?.weightKg)
  return suggestion && suggestion.sameSize ? applyWeightEstimates(lines, suggestion) : lines
}
