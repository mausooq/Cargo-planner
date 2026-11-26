import { describe, expect, it } from "vitest"
import { blankLine, compareTotals, evaluateLine, findDuplicates, isImportable, summarize, type ReviewLine } from "@/lib/import-review"

function line(overrides: Partial<ReviewLine> = {}): ReviewLine {
  return {
    ...blankLine("l1"),
    sku: "C-1",
    name: "Wooden crate",
    length: "120",
    width: "80",
    height: "60",
    sizeUnit: "cm",
    quantity: "10",
    weight: "150",
    weightUnit: "kg",
    ...overrides,
  }
}

describe("a complete line", () => {
  it("is ready and builds the cargo line in centimetres and kilograms", () => {
    const evaluation = evaluateLine(line())
    expect(evaluation.status).toBe("ready")
    expect(isImportable(evaluation)).toBe(true)
    expect(evaluation.input).toMatchObject({ sku: "C-1", name: "Wooden crate", lengthCm: 120, widthCm: 80, heightCm: 60, weightKg: 150, quantity: 10, shape: "BOX" })
    expect(evaluation.volumeM3).toBeCloseTo(5.76, 5)
  })

  it("keeps the planner's defaults for things the document did not say", () => {
    const input = evaluateLine(line()).input!
    expect(input.stackable).toBe(true)
    expect(input.destinationStop).toBe(1)
    expect(input.consignmentId).toBeNull()
    expect(Object.keys(input)).not.toContain("clearanceCm")
  })

  it("applies only what the document stated", () => {
    const input = evaluateLine(line({ stackable: false, floorOnly: true, orientation: "FIXED", consignment: "PO-9", destination: "2", hazard: "Class 3" })).input!
    expect(input).toMatchObject({ stackable: false, bottomOnly: true, orientation: "FIXED", consignmentId: "PO-9", destinationStop: 2, segregationClass: "Class 3" })
  })

  it("uses the mark as the name when there is no description", () => {
    expect(evaluateLine(line({ name: "" })).input?.name).toBe("C-1")
  })
})

describe("missing and invalid values are flagged, never filled in", () => {
  it("reports each missing field", () => {
    const evaluation = evaluateLine(line({ length: "", quantity: "", weight: "", name: "", sku: "" }))
    expect(evaluation.status).toBe("missing")
    expect(evaluation.input).toBeNull()
    expect(evaluation.issues.map((issue) => issue.field).sort()).toEqual(["length", "name", "quantity", "weight"])
  })

  it("rejects zero, negative and unreadable values", () => {
    expect(evaluateLine(line({ width: "0" })).status).toBe("invalid")
    expect(evaluateLine(line({ height: "-3" })).status).toBe("invalid")
    expect(evaluateLine(line({ length: "tall" })).status).toBe("invalid")
    expect(evaluateLine(line({ quantity: "2.5" })).status).toBe("invalid")
    expect(evaluateLine(line({ weight: "heavy" })).status).toBe("invalid")
  })

  it("asks for the unit when the document does not state one", () => {
    const evaluation = evaluateLine(line({ sizeUnit: null }))
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluation.issues).toContainEqual(expect.objectContaining({ field: "sizeUnit", kind: "ambiguous", code: "size-unit" }))
    expect(evaluation.issues.every((issue) => issue.code === "size-unit")).toBe(true)
    expect(evaluation.input).toBeNull()
    // The numbers that were read are still there, untouched.
    expect([evaluation.sizesCm]).toEqual([null])
  })

  it("asks for the weight unit when it is not stated", () => {
    const evaluation = evaluateLine(line({ weightUnit: null }))
    expect(evaluation.issues).toEqual([expect.objectContaining({ field: "weightUnit", kind: "ambiguous" })])
  })

  it("does not need a unit chosen when each size carries its own", () => {
    const evaluation = evaluateLine(line({ sizeUnit: null, length: "1.2 m", width: "800 mm", height: "2 ft" }))
    expect(evaluation.status).toBe("ready")
    expect(evaluation.sizesCm).toEqual([120, 80, 60.96])
  })
})

describe("sizes in feet and inches", () => {
  it("keeps 5.6 ft and 5 ft 6 in apart", () => {
    expect(evaluateLine(line({ sizeUnit: "ft", length: "5.6", width: "1", height: "1" })).sizesCm?.[0]).toBeCloseTo(170.688, 3)
    expect(evaluateLine(line({ sizeUnit: "ft", length: "5 ft 6 in", width: "1", height: "1" })).sizesCm?.[0]).toBeCloseTo(167.64, 3)
    expect(evaluateLine(line({ sizeUnit: null, length: "5'6\"", width: "1 ft", height: "1 ft" })).sizesCm?.[0]).toBeCloseTo(167.64, 3)
  })

  it("converts inches and metres", () => {
    expect(evaluateLine(line({ sizeUnit: "in", length: "48", width: "32", height: "24" })).sizesCm).toEqual([121.92, 81.28, 60.96])
    expect(evaluateLine(line({ sizeUnit: "m", length: "1.2", width: "0.8", height: "0.6" })).sizesCm).toEqual([120, 80, 60])
  })
})

describe("weight per piece, line total and net weight", () => {
  it("works out a per-piece weight from an explicit line total, as a note and not as a blocker", () => {
    const evaluation = evaluateLine(line({ quantity: "5", weight: "750", weightScope: "line" }))
    expect(evaluation.perPieceKg).toBe(150)
    expect(evaluation.interpretation).toBe("Line total 750 kg ÷ 5 pieces = 150 kg per piece")
    expect(evaluation.origins.weight).toBe("calculated")
    expect(evaluation.status).toBe("ready")
    expect(evaluation.notes).toContainEqual({ code: "weight-calculated", message: "Line total 750 kg ÷ 5 pieces = 150 kg per piece." })
    expect(evaluation.input?.weightKg).toBe(150)
    expect(evaluation.lineKg).toBe(750)
  })

  it("cannot divide a line total without a quantity", () => {
    const evaluation = evaluateLine(line({ quantity: "", weight: "750", weightScope: "line" }))
    expect(evaluation.perPieceKg).toBeNull()
    expect(evaluation.status).toBe("missing")
  })

  it("keeps a per-piece weight as given and multiplies for the line", () => {
    const evaluation = evaluateLine(line({ quantity: "5", weight: "150", weightScope: "piece" }))
    expect(evaluation.perPieceKg).toBe(150)
    expect(evaluation.lineKg).toBe(750)
    expect(evaluation.origins.weight).toBe("source")
  })

  it("will not read a weight whose scope is unclear", () => {
    const evaluation = evaluateLine(line({ weightScope: "unclear" }))
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluation.issues[0]).toMatchObject({ field: "weightScope" })
  })

  it("flags a net weight until it is replaced or confirmed", () => {
    expect(evaluateLine(line({ weightKind: "net" })).status).toBe("ambiguous")
    expect(evaluateLine(line({ weightKind: "net", confirmed: ["net"] })).status).toBe("ready")
  })

  it("converts grams, tonnes and pounds, with the unit written in the cell winning", () => {
    expect(evaluateLine(line({ weight: "2500", weightUnit: "g" })).perPieceKg).toBe(2.5)
    expect(evaluateLine(line({ weight: "1.2 t" })).perPieceKg).toBe(1200)
    expect(evaluateLine(line({ weight: "330 lb", weightUnit: "kg" })).perPieceKg).toBe(149.6855)
  })
})

describe("ambiguous number formats", () => {
  it("flags 1,200 until the planner confirms how to read it", () => {
    const evaluation = evaluateLine(line({ quantity: "1,200" }))
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluation.pieces).toBe(1200)
    expect(evaluateLine(line({ quantity: "1,200", confirmed: ["numbers"] })).status).toBe("ready")
  })
})

describe("status", () => {
  it("shows a line the planner changed as corrected, and an excluded one as excluded", () => {
    expect(evaluateLine(line({ edited: ["height"] })).status).toBe("corrected")
    const excluded = evaluateLine(line({ include: false }))
    expect(excluded.status).toBe("excluded")
    expect(isImportable(excluded)).toBe(false)
  })

  it("never lets an incomplete line be importable", () => {
    expect(isImportable(evaluateLine(line({ weight: "" })))).toBe(false)
    expect(isImportable(evaluateLine(line({ edited: ["name"], length: "" })))).toBe(false)
  })
})

describe("totals", () => {
  it("adds up included lines and says when totals leave something out", () => {
    const lines = [line({ id: "a" }), line({ id: "b", quantity: "5", weight: "20" }), line({ id: "c", weight: "" }), line({ id: "d", include: false })]
    const evaluations = lines.map(evaluateLine)
    const summary = summarize(lines, evaluations)
    expect(summary).toMatchObject({ detected: 4, included: 3, importable: 2, needReview: 1, pieces: 25, weightKg: 1600, incomplete: true })
    expect(summary.volumeM3).toBeCloseTo(5.76 + 2.88 + 5.76, 5)
  })

  it("is complete when every included line is complete", () => {
    const lines = [line()]
    expect(summarize(lines, lines.map(evaluateLine)).incomplete).toBe(false)
  })

  it("compares the lines with the totals the document states, without changing either", () => {
    const lines = [line({ quantity: "5", weight: "100" })]
    const summary = summarize(lines, lines.map(evaluateLine))
    expect(compareTotals(summary, { pieces: 5, weightKg: 500 })).toEqual([])
    expect(compareTotals(summary, { pieces: 7, weightKg: 900 })).toHaveLength(2)
    expect(compareTotals(summary, null)).toEqual([])
  })
})

describe("duplicates are shown, not removed", () => {
  it("notes repeated lines in one import and leaves them all", () => {
    const lines = [line({ id: "a" }), line({ id: "b" }), line({ id: "c", sku: "C-2" })]
    const notes = findDuplicates(lines, lines.map(evaluateLine), [])
    expect(notes.get("a")?.[0]).toMatch(/line 2/)
    expect(notes.get("b")?.[0]).toMatch(/line 1/)
    expect(notes.has("c")).toBe(false)
  })

  it("notes cargo already in the project", () => {
    const lines = [line()]
    const notes = findDuplicates(lines, lines.map(evaluateLine), [{ sku: "c-1", name: "Wooden crate", lengthCm: 120, widthCm: 80, heightCm: 60, weightKg: 150 }])
    expect(notes.get("l1")?.[0]).toMatch(/already has/)
  })

  it("notes the same source row read twice", () => {
    const lines = [line({ id: "a", source: { page: 2, row: 4 } }), line({ id: "b", source: { page: 2, row: 4 } })]
    const notes = findDuplicates(lines, lines.map(evaluateLine), [])
    expect(notes.get("a")?.some((note) => /read more than once/.test(note))).toBe(true)
  })
})

describe("handling clearance is not part of the import", () => {
  it("a review line has no clearance field, and a stale one is simply not used", () => {
    expect(Object.keys(blankLine("x"))).not.toContain("clearance")
    const withLegacyField = { ...line(), clearance: "9" } as ReviewLine
    expect(Object.keys(evaluateLine(withLegacyField).input!)).not.toContain("clearanceCm")
  })
})
