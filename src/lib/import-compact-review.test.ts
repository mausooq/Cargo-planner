import { describe, expect, it } from "vitest"
import { extractionToReview, type RawExtraction, type RawLine } from "@/lib/cargo-extract"
import { applyEdit, applySizeUnit, applyWeightUnit, dimensionText, sourceTarget, weightPatch } from "@/lib/import-edit"
import {
  blankLine,
  consolidateIssues,
  describeRows,
  displayDimension,
  evaluateLine,
  isImportable,
  summarize,
  toDraft,
  type ReviewLine,
} from "@/lib/import-review"

// Synthetic data only: nothing here is a real customer document, and no model is called.

const reader = { provider: "test", model: "test-model" }

function rawLine(overrides: Partial<RawLine> = {}): RawLine {
  return {
    reference: null,
    description: null,
    descriptionEnglish: null,
    length: null,
    width: null,
    height: null,
    combinedSize: null,
    sizeUnit: null,
    quantity: null,
    grossWeight: null,
    netWeight: null,
    weight: null,
    weightScope: null,
    weightScopeEvidence: null,
    weightUnit: null,
    shape: null,
    stackable: null,
    floorOnly: null,
    orientationRestriction: null,
    consignment: null,
    destination: null,
    hazardClass: null,
    handling: null,
    source: { page: null, row: null, quote: null },
    uncertain: [],
    ...overrides,
  }
}

function raw(lines: RawLine[], overrides: Partial<RawExtraction> = {}): RawExtraction {
  return { summary: "A packing list.", language: "English", lines, documentTotals: null, warnings: [], unreadable: [], complete: true, tableSizeUnit: null, ...overrides }
}

const review = (lines: RawLine[], overrides: Partial<RawExtraction> = {}) => extractionToReview(raw(lines, overrides), "pdf", reader)

/** A packing list shaped like the one that blocked the import: net and gross, quantity 1 and 2, sizes with no unit. */
const rt = (reference: string, overrides: Partial<RawLine> = {}) =>
  rawLine({ reference, description: `Machine ${reference}`, combinedSize: "1000 x 1000 x 1000", quantity: "1", grossWeight: "2360", netWeight: "2210", weightScope: "unclear", source: { page: 1, row: reference.replace(/\D/g, ""), quote: `${reference} 1000 x 1000 x 1000` }, ...overrides })

describe("net and gross weights are separate numbers", () => {
  it("keeps the gross weight for planning and the net weight as reference", () => {
    const [line] = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg" })]).lines
    expect(line).toMatchObject({ weight: "2360", weightKind: "gross", netWeight: "2210" })
    const evaluation = evaluateLine(line!)
    expect(evaluation.perPieceKg).toBe(2360)
    expect(evaluation.status).toBe("ready")
    expect(evaluation.input).toMatchObject({ weightKg: 2360, quantity: 1 })
    expect(evaluation.notes.map((note) => note.code)).toContain("net-reference")
  })

  it("repairs a reading that joined them, so the line is not blocked by '2210 net / 2360 gross'", () => {
    const joined = rt("RT2", { sizeUnit: "mm", weightUnit: "kg", grossWeight: null, netWeight: null, weight: "2210 net / 2360 gross" })
    const [line] = review([joined]).lines
    expect(line).toMatchObject({ weight: "2360", weightKind: "gross", netWeight: "2210" })
    expect(line!.infoNotes.join(" ")).toMatch(/separated/)
    expect(evaluateLine(line!)).toMatchObject({ status: "ready", perPieceKg: 2360 })
  })

  it("repairs a joined value in either weight field", () => {
    for (const field of ["grossWeight", "netWeight", "weight"] as const) {
      const [line] = review([rt("RTx", { sizeUnit: "mm", weightUnit: "kg", grossWeight: null, netWeight: null, [field]: "NW 2210 kg / GW 2360 kg" })]).lines
      expect(line, field).toMatchObject({ weight: "2360 kg", netWeight: "2210 kg" })
    }
  })

  it("uses the net weight only when it is the only one, and asks first", () => {
    const [line] = review([rt("RT3", { sizeUnit: "mm", weightUnit: "kg", grossWeight: null, netWeight: "2210" })]).lines
    expect(line).toMatchObject({ weight: "2210", weightKind: "net", netWeight: "" })
    const evaluation = evaluateLine(line!)
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluation.issues[0]).toMatchObject({ code: "net-only" })
    expect(evaluation.weightResolved).toBe(false)
    expect(evaluateLine({ ...line!, confirmed: ["net"] }).status).toBe("ready")
  })

  it("asks when the net weight is higher than the gross weight", () => {
    const [line] = review([rt("RT4", { sizeUnit: "mm", weightUnit: "kg", grossWeight: "2000", netWeight: "2210" })]).lines
    expect(evaluateLine(line!).issues).toContainEqual(expect.objectContaining({ code: "net-gt-gross", kind: "confirm" }))
  })

  it("never uses the net weight in the planning figure when a gross weight is given", () => {
    const [line] = review([rt("RT5x", { sizeUnit: "mm", weightUnit: "kg" })]).lines
    expect(evaluateLine(line!).input?.weightKg).not.toBe(2210)
  })
})

describe("one piece, or several: what the weight is for", () => {
  const withQuantity = (quantity: string, overrides: Partial<RawLine> = {}) => review([rt("RT", { sizeUnit: "mm", weightUnit: "kg", quantity, ...overrides })]).lines[0]!

  it("needs no interpretation for a quantity of one, even when the document does not say", () => {
    for (const weightScope of ["unclear", "per_piece", "line_total", null] as const) {
      const evaluation = evaluateLine(withQuantity("1", { weightScope }))
      expect(evaluation.status, String(weightScope)).toBe("ready")
      expect(evaluation.perPieceKg).toBe(2360)
      expect(evaluation.issues).toEqual([])
    }
  })

  it("keeps the number and asks when the quantity is above one and the document does not say", () => {
    const line = withQuantity("2")
    const evaluation = evaluateLine(line)
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: "weight-scope", field: "weightScope" }))
    // Never assumed to be per piece, and never multiplied.
    expect(evaluation.perPieceKg).toBeNull()
    expect(evaluation.lineKg).toBeNull()
    expect(line.weight).toBe("2360")
    expect(evaluation.input).toBeNull()
  })

  it("is settled by the planner's choice, either way, and the choice is theirs", () => {
    const line = withQuantity("2")
    const each = evaluateLine(applyEdit(line, { weightScope: "piece" }, ["weightScope"]))
    expect(each).toMatchObject({ status: "corrected", perPieceKg: 2360, lineKg: 4720 })
    const total = evaluateLine(applyEdit(line, { weightScope: "line" }, ["weightScope"]))
    expect(total).toMatchObject({ perPieceKg: 1180, lineKg: 2360 })
  })

  it("uses a per-piece weight directly when the document says so", () => {
    const evaluation = evaluateLine(withQuantity("2", { weightScope: "per_piece", weightScopeEvidence: "Gross weight per package" }))
    expect(evaluation).toMatchObject({ status: "ready", perPieceKg: 2360, lineKg: 4720 })
  })

  it("divides an explicit line total by the quantity, without asking", () => {
    const evaluation = evaluateLine(withQuantity("2", { weightScope: "line_total", weightScopeEvidence: "Total gross weight" }))
    expect(evaluation).toMatchObject({ status: "ready", perPieceKg: 1180, lineKg: 2360 })
    expect(evaluation.origins.weight).toBe("calculated")
    expect(evaluation.notes.map((note) => note.code)).toContain("weight-calculated")
  })

  it("needs the quantity before a line total can be divided", () => {
    const evaluation = evaluateLine(withQuantity("", { weightScope: "line_total" }))
    expect(evaluation.perPieceKg).toBeNull()
    expect(evaluation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["qty-missing", "weight-needs-qty"]))
  })

  it("keeps what the document says about it, for the details", () => {
    expect(withQuantity("2", { weightScopeEvidence: "Column: Gross weight" }).weightEvidence).toBe("Column: Gross weight")
  })
})

describe("sizes with no unit keep their numbers", () => {
  const unknown = () => review([rt("RT1", { weightUnit: "kg" })]).lines[0]!

  it("keeps all three numbers as read and asks for the unit", () => {
    const line = unknown()
    expect([line.length, line.width, line.height]).toEqual(["1000", "1000", "1000 "].map((part) => part.trim()))
    expect(line.sizeUnit).toBeNull()
    const evaluation = evaluateLine(line)
    expect(evaluation.sizesCm).toBeNull()
    expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: "size-unit", field: "sizeUnit" }))
    expect(evaluation.status).toBe("ambiguous")
  })

  it("shows the original numbers in the table, whatever unit the table displays", () => {
    const line = unknown()
    for (const unit of ["mm", "cm", "m", "in", "ft"] as const) {
      expect(displayDimension(line, "length", unit)).toEqual({ text: "1000", converted: false })
    }
  })

  it("converts after the unit is chosen, without retyping anything", () => {
    const [chosen] = applySizeUnit([unknown()], new Set(["ai-1"]), "mm")
    expect(chosen!.length).toBe("1000")
    expect(evaluateLine(chosen!).sizesCm).toEqual([100, 100, 100])
    expect(displayDimension(chosen!, "length", "cm")).toEqual({ text: "100", converted: true })
    expect(displayDimension(chosen!, "length", "m")).toEqual({ text: "1", converted: true })
    expect(displayDimension(chosen!, "length", "in")).toEqual({ text: "39.37", converted: true })
    expect(evaluateLine(chosen!).status).toBe("corrected")
  })

  it("one choice covers every row that lacks a unit, and leaves rows that have one alone", () => {
    const lines = review([rt("RT1", { weightUnit: "kg" }), rt("RT2", { weightUnit: "kg" }), rt("RT3", { weightUnit: "kg", sizeUnit: "cm", combinedSize: "100 x 100 x 100" })]).lines
    const needing = new Set(lines.filter((line) => evaluateLine(line).issues.some((issue) => issue.code === "size-unit")).map((line) => line.id))
    expect([...needing]).toEqual(["ai-1", "ai-2"])
    const applied = applySizeUnit(lines, needing, "cm")
    expect(applied.map((line) => line.sizeUnit)).toEqual(["cm", "cm", "cm"])
    expect(applied.map((line) => evaluateLine(line).sizesCm?.[0])).toEqual([1000, 1000, 100])
  })

  it("takes a unit stated once for the whole table, and says where it came from", () => {
    const lines = review([rt("RT1", { weightUnit: "kg" }), rt("RT2", { weightUnit: "kg", sizeUnit: "m", combinedSize: "1 x 1 x 1" })], { tableSizeUnit: "mm" }).lines
    expect(lines[0]).toMatchObject({ sizeUnit: "mm" })
    expect(lines[0]!.infoNotes.join(" ")).toMatch(/taken from the table heading/)
    expect(evaluateLine(lines[0]!)).toMatchObject({ status: "ready", sizesCm: [100, 100, 100] })
    // A line that states its own unit keeps it.
    expect(lines[1]).toMatchObject({ sizeUnit: "m" })
    expect(lines[1]!.infoNotes).toEqual([])
  })

  it("does not decide a unit from the size, and does not reorder or relabel the sizes", () => {
    const [line] = review([rt("RT1", { combinedSize: "1200 x 800 x 600", weightUnit: "kg" })]).lines
    expect([line!.length, line!.width, line!.height]).toEqual(["1200", "800", "600"])
    expect(line!.sizeUnit).toBeNull()
    expect(line!.orientation).toBeNull()
    expect(evaluateLine(line!).input).toBeNull()
  })

  it("does not infer a rotation permission from the order the sizes are written in", () => {
    const [line] = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg", combinedSize: "3000 x 500 x 400" })]).lines
    expect(evaluateLine(line!).input?.orientation).toBe(blankDefaultOrientation())
  })

  it("shows the converted unit on the heading and the converted size in the table", () => {
    const line = review([rt("RT1", { sizeUnit: "ft", weightUnit: "kg", combinedSize: "5 x 3 x 2" })]).lines[0]!
    expect(displayDimension(line, "length", "ft")).toEqual({ text: "5", converted: true })
    expect(displayDimension(line, "length", "cm")).toEqual({ text: "152.4", converted: true })
    expect(displayDimension(line, "width", "in")).toEqual({ text: "36", converted: true })
  })
})

function blankDefaultOrientation() {
  const line = { ...blankLine("x"), name: "x", length: "3000 mm", width: "500 mm", height: "400 mm", quantity: "1", weight: "10 kg" }
  return evaluateLine(line).input?.orientation
}

describe("typing in the table", () => {
  it("writes a plain number in the unit the column shows, and keeps one that carries its own", () => {
    expect(dimensionText("120", "cm")).toBe("120 cm")
    expect(dimensionText(" 5.5 ", "ft")).toBe("5.5 ft")
    expect(dimensionText("5 ft 6 in", "cm")).toBe("5 ft 6 in")
    expect(dimensionText("1200 mm", "ft")).toBe("1200 mm")
    expect(dimensionText("", "cm")).toBe("")
  })

  it("reads what was typed in the unit it was typed in, whatever the row's own unit was", () => {
    const line = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg" })]).lines[0]!
    const edited = applyEdit(line, { length: dimensionText("5", "ft") }, ["length"])
    expect(evaluateLine(edited).sizesCm).toEqual([152.4, 100, 100])
    expect(edited.edited).toContain("length")
  })

  it("keeps 5.5 ft and 5 ft 6 in apart", () => {
    const base = blankLine("a")
    const ft = (text: string) => evaluateLine({ ...base, name: "a", length: dimensionText(text, "ft"), width: "1 ft", height: "1 ft", quantity: "1", weight: "1 kg" }).sizesCm?.[0]
    expect(ft("5.6")).toBeCloseTo(170.688, 3)
    expect(ft("5 ft 6 in")).toBeCloseTo(167.64, 3)
  })

  it("a typed weight is the planning weight of one piece in kilograms, and settles the doubt about what it is for", () => {
    const line = review([rt("RT", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" })]).lines[0]!
    expect(evaluateLine(line).status).toBe("ambiguous")
    const change = weightPatch("1180", line)
    const edited = applyEdit(line, change.patch, change.touched)
    expect(edited).toMatchObject({ weight: "1180 kg", weightScope: "piece" })
    expect(evaluateLine(edited)).toMatchObject({ status: "corrected", perPieceKg: 1180 })
  })

  it("typing a weight over a net-only line replaces the net weight, so it no longer needs a confirmation", () => {
    const line = review([rt("RT", { sizeUnit: "mm", weightUnit: "kg", grossWeight: null, netWeight: "2210" })]).lines[0]!
    const change = weightPatch("2360", line)
    expect(evaluateLine(applyEdit(line, change.patch, change.touched)).status).toBe("corrected")
  })

  it("changing a value takes a confirmation of the old one away", () => {
    const line = { ...blankLine("a"), confirmed: ["weight", "net", "numbers"] as ReviewLine["confirmed"] }
    expect(applyEdit(line, { weight: "5 kg" }, ["weight"]).confirmed).toEqual(["numbers"].filter(() => false))
    expect(applyEdit(line, { name: "x" }, ["name"]).confirmed).toEqual(["weight", "net", "numbers"])
  })

  it("a weight unit chosen once covers every row without one", () => {
    const lines = review([rt("RT1", { sizeUnit: "mm" }), rt("RT2", { sizeUnit: "mm" })]).lines
    expect(lines.map((line) => evaluateLine(line).issues.some((issue) => issue.code === "weight-unit"))).toEqual([true, true])
    const applied = applyWeightUnit(lines, new Set(lines.map((line) => line.id)), "kg")
    expect(applied.map((line) => evaluateLine(line).status)).toEqual(["corrected", "corrected"])
  })
})

describe("totals follow the selected rows and say when they are partial", () => {
  const lines = () =>
    review([
      rt("RT1", { sizeUnit: "mm", weightUnit: "kg", quantity: "1" }),
      rt("RT2", { sizeUnit: "mm", weightUnit: "kg", quantity: "2", weightScope: "per_piece" }),
      rt("RT3", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" }),
      rt("RT4", { weightUnit: "kg", quantity: "1" }),
    ]).lines
  const summary = (all: ReviewLine[]) => summarize(all, all.map(evaluateLine))

  it("counts every piece whose quantity is known, even where the weight or size is not", () => {
    const result = summary(lines())
    expect(result).toMatchObject({ detected: 4, included: 4, pieces: 6, piecesUnknownLines: 0 })
    // RT3's weight is unresolved and RT4's size has no unit: neither is silently assumed.
    expect(result.weightKg).toBe(2360 + 4720 + 2360)
    expect(result.weightUnresolvedLines).toBe(1)
    expect(result.volumeUnresolvedLines).toBe(1)
    expect(result.volumeM3).toBeCloseTo(1 + 2 + 2, 6)
    expect(result.incomplete).toBe(true)
    expect(result.needReview).toBe(2)
  })

  it("updates the moment a row is excluded, edited or settled", () => {
    const all = lines()
    const without = all.map((line) => (line.id === "ai-2" ? { ...line, include: false } : line))
    expect(summary(without)).toMatchObject({ included: 3, pieces: 4 })
    expect(summary(without).weightKg).toBe(2360 + 2360)
    const settled = all.map((line) => (line.id === "ai-3" ? applyEdit(line, { weightScope: "piece" }, ["weightScope"]) : line))
    expect(summary(settled).weightUnresolvedLines).toBe(0)
    expect(summary(settled).weightKg).toBe(2360 + 4720 + 4720 + 2360)
    const withUnit = applySizeUnit(all, new Set(["ai-4"]), "mm")
    expect(summary(withUnit).volumeUnresolvedLines).toBe(0)
  })

  it("does not put an unsettled weight in the total", () => {
    const only = review([rt("RT3", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" })]).lines
    const result = summary(only)
    expect(result.weightKg).toBe(0)
    expect(result.weightUnresolvedLines).toBe(1)
    expect(result.pieces).toBe(2)
  })

  it("does not let a missing weight or size stop a valid quantity counting", () => {
    const only = review([rawLine({ description: "Crate", quantity: "7" })]).lines
    expect(summary(only)).toMatchObject({ pieces: 7, weightKg: 0, volumeM3: 0, weightUnresolvedLines: 1, volumeUnresolvedLines: 1 })
  })

  it("is complete only when nothing is left out", () => {
    const ready = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg" })]).lines
    expect(summary(ready)).toMatchObject({ incomplete: false, needReview: 0, importable: 1 })
  })

  it("counts only the selected rows", () => {
    const none = lines().map((line) => ({ ...line, include: false }))
    expect(summary(none)).toMatchObject({ included: 0, pieces: 0, weightKg: 0, volumeM3: 0, incomplete: false })
  })
})

describe("one box of warnings, in three kinds", () => {
  const all = review([
    rt("RT1", { sizeUnit: "mm", weightUnit: "kg" }),
    rt("RT2", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" }),
    rt("RT3", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" }),
    rt("RT4", { weightUnit: "kg" }),
    rt("RT5", { sizeUnit: "mm", weightUnit: "kg", quantity: "", grossWeight: null, netWeight: null }),
    rt("RT6", { sizeUnit: "mm", weightUnit: "kg", quantity: "3", weightScope: "line_total" }),
  ]).lines
  const groups = consolidateIssues(all, all.map(evaluateLine))

  it("separates what needs fixing, what needs confirming and what is only information", () => {
    expect(groups.required.map((group) => group.key).sort()).toEqual(["qty-missing", "weight-missing"].sort())
    expect(groups.confirm.map((group) => group.key).sort()).toEqual(["size-unit", "weight-scope"].sort())
    expect(groups.info.map((group) => group.key)).toEqual(expect.arrayContaining(["net-reference", "weight-calculated", "unit-converted:Sizes converted from mm to cm."]))
  })

  it("says each thing once, with the rows it applies to, not once per row", () => {
    const scope = groups.confirm.find((group) => group.key === "weight-scope")!
    expect(scope.rows).toEqual([2, 3])
    expect(groups.info.find((group) => group.key === "net-reference")!.rows).toEqual([1, 2, 3, 4, 6])
    const total = [...groups.required, ...groups.confirm, ...groups.info].length
    expect(total).toBeLessThan(all.length * 3)
  })

  it("treats a successful unit conversion as information, never as an error", () => {
    expect(groups.required.some((group) => /convert/i.test(group.message))).toBe(false)
    expect(groups.confirm.some((group) => /convert/i.test(group.message))).toBe(false)
    expect(groups.info.some((group) => /converted from mm/i.test(group.message))).toBe(true)
  })

  it("leaves out rows that are not selected", () => {
    const off = all.map((line) => ({ ...line, include: false }))
    expect(consolidateIssues(off, off.map(evaluateLine))).toEqual({ required: [], confirm: [], info: [] })
  })

  it("describes rows briefly", () => {
    expect(describeRows([3])).toBe("row 3")
    expect(describeRows([3, 5])).toBe("rows 3, 5")
    expect(describeRows([1, 2, 3, 4, 5])).toBe("rows 1 to 5")
    expect(describeRows([9, 1, 2, 3, 7])).toBe("rows 1 to 3, 7, 9")
  })
})

describe("incomplete lines as drafts", () => {
  it("keeps what is settled, leaves what is not at zero, and writes what the document said into notes", () => {
    const line = review([rt("RT5", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" })]).lines[0]!
    const evaluation = evaluateLine(line)
    expect(isImportable(evaluation)).toBe(false)
    const draft = toDraft(line, evaluation)!
    expect(draft.input).toMatchObject({ name: "Machine RT5", sku: "RT5", quantity: 2, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 0 })
    expect(draft.notes.join(" ")).toMatch(/Weight as written: 2360 kg \(per piece or for the line not stated\)/)
    expect(draft.notes.join(" ")).toMatch(/Net weight as written: 2210/)
  })

  it("never turns an unknown unit into dimensions: the sizes stay at zero and the numbers go into the notes", () => {
    const line = review([rt("RT1", { weightUnit: "kg" })]).lines[0]!
    const draft = toDraft(line, evaluateLine(line))!
    expect([draft.input.lengthCm, draft.input.widthCm, draft.input.heightCm]).toEqual([0, 0, 0])
    expect(draft.notes.join(" ")).toMatch(/Size as written: 1000 × 1000 × 1000 \(unit not stated\)/)
    expect(draft.input.weightKg).toBe(2360)
  })

  it("is never made out to be a plannable line", () => {
    const line = review([rt("RT5", { sizeUnit: "mm", weightUnit: "kg", quantity: "2" })]).lines[0]!
    const { input } = toDraft(line, evaluateLine(line))!
    expect(input.weightKg === 0 || input.lengthCm === 0).toBe(true)
  })

  it("is not offered without a quantity and a name", () => {
    expect(toDraft(...pair(review([rawLine({ description: "Crate" })]).lines[0]!))).toBeNull()
    expect(toDraft(...pair(review([rawLine({ quantity: "2" })]).lines[0]!))).toBeNull()
    expect(toDraft(...pair(review([rawLine({ reference: "A-1", quantity: "2" })]).lines[0]!))).not.toBeNull()
  })

  it("does not use a draft for a line that is already complete", () => {
    const line = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg" })]).lines[0]!
    expect(evaluateLine(line).input).not.toBeNull()
  })
})

function pair(line: ReviewLine): [ReviewLine, ReturnType<typeof evaluateLine>] {
  return [line, evaluateLine(line)]
}

describe("the original document is shown only where it was really referenced", () => {
  it("points to a page, a row or a quote, in that order, and to nothing otherwise", () => {
    expect(sourceTarget({ page: 3, row: 7, quote: "x" })).toEqual({ kind: "page", page: 3 })
    expect(sourceTarget({ row: 7, sheet: "Sheet1" })).toEqual({ kind: "row", row: 7, sheet: "Sheet1" })
    expect(sourceTarget({ quote: "10 crates" })).toEqual({ kind: "quote", quote: "10 crates" })
    expect(sourceTarget({})).toEqual({ kind: "none" })
  })

  it("a reading that gave no page, row or quote leaves the line without a source reference", () => {
    const [line] = review([rawLine({ description: "Crate", quantity: "1" })]).lines
    expect(line!.source).toEqual({})
    expect(sourceTarget(line!.source)).toEqual({ kind: "none" })
  })

  it("keeps the page and row a reading reported, and does not invent one", () => {
    const [line] = review([rt("RT7")]).lines
    expect(line!.source).toMatchObject({ page: 1, row: 7 })
  })
})

describe("original values are kept next to the edits", () => {
  it("remembers what was read, whatever the planner changes afterwards", () => {
    const line = review([rt("RT1", { sizeUnit: "mm", weightUnit: "kg" })]).lines[0]!
    const edited = applyEdit(line, { length: "5 ft", weight: "1 kg" }, ["length", "weight"])
    expect(edited.original).toMatchObject({ length: "1000", weight: "2360", netWeight: "2210", sizeUnit: "mm", weightUnit: "kg" })
    expect(edited.length).toBe("5 ft")
  })
})
