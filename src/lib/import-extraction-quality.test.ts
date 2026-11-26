import { describe, expect, it } from "vitest"
import { extractionToReview, type RawExtraction, type RawLine } from "@/lib/cargo-extract"
import { linesNeedingWeightConfirmation } from "@/lib/cargo-validation"
import {
  acceptWeightEstimates,
  applyWeightEstimates,
  blankLine,
  clearWeightEstimates,
  displayDimension,
  evaluateLine,
  expandMarkRange,
  isImportable,
  suggestWeightDistribution,
  summarize,
  toDraft,
  withSuggestedEstimates,
  type ReviewLine,
} from "@/lib/import-review"

// Synthetic data only: nothing here is a real customer document, and no model is called.

const reader = { provider: "test", model: "test-model" }

function rawLine(overrides: Partial<RawLine> = {}): RawLine {
  return {
    reference: null,
    packageType: null,
    description: null,
    descriptionEnglish: null,
    length: null,
    width: null,
    height: null,
    combinedSize: null,
    sizeUnit: null,
    quantity: null,
    contentsQuantity: null,
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

const review = (lines: RawLine[], overrides: Partial<RawExtraction> = {}) =>
  extractionToReview({ summary: "A packing list.", language: "English", lines, documentTotals: null, warnings: [], unreadable: [], complete: true, tableSizeUnit: null, ...overrides }, "pdf", reader)

function line(overrides: Partial<ReviewLine> = {}): ReviewLine {
  return { ...blankLine("l1"), sku: "C-1", name: "Crate", length: "120", width: "80", height: "60", sizeUnit: "cm", quantity: "1", weight: "", weightUnit: "kg", ...overrides }
}

const kgOf = (lines: ReviewLine[]) => lines.map((entry) => Number(entry.estimatedWeight))
const hundredths = (values: number[], pieces: number[] = values.map(() => 1)) => values.reduce((sum, value, index) => sum + Math.round(value * 100) * pieces[index]!, 0)

describe("boxes listed by a range of marks", () => {
  it("gives every box in S-1 to S-6 its own line with a quantity of 1", () => {
    const result = review([rawLine({ reference: "S-1 to S-6", packageType: "wooden box", description: "Spare parts", combinedSize: "100 x 80 x 60 cm", quantity: "6", grossWeight: "150 kg", weightScope: "per_piece" })])
    expect(result.lines.map((entry) => entry.sku)).toEqual(["S-1", "S-2", "S-3", "S-4", "S-5", "S-6"])
    expect(result.lines.every((entry) => entry.quantity === "1" && entry.weight === "150 kg")).toBe(true)
    expect(new Set(result.lines.map((entry) => entry.id)).size).toBe(6)
    expect(result.lines.map(evaluateLine).every((evaluation) => evaluation.pieces === 1 && evaluation.perPieceKg === 150)).toBe(true)
  })

  it("understands other ways of writing a range, and keeps leading zeros", () => {
    expect(expandMarkRange(line({ sku: "S-01 – S-03", quantity: "3" })).map((entry) => entry.sku)).toEqual(["S-01", "S-02", "S-03"])
    expect(expandMarkRange(line({ sku: "C1-4", quantity: "4" })).map((entry) => entry.sku)).toEqual(["C1", "C2", "C3", "C4"])
  })

  it("leaves a range alone when the quantity does not say that many packages", () => {
    expect(expandMarkRange(line({ sku: "S-1 to S-6", quantity: "12" }))).toHaveLength(1)
    expect(expandMarkRange(line({ sku: "S-1 to S-6", quantity: "" }))).toHaveLength(1)
    expect(expandMarkRange(line({ sku: "PO 2024-118", quantity: "1" }))).toHaveLength(1)
  })

  it("shares a weight given for the whole range out as estimates that add up to it exactly", () => {
    const boxes = expandMarkRange(line({ sku: "S-1 to S-3", quantity: "3", weight: "100", weightScope: "line" }))
    expect(boxes.every((entry) => entry.weight === "")).toBe(true)
    expect(hundredths(kgOf(boxes))).toBe(10000)
    expect(boxes.map(evaluateLine).every((evaluation) => evaluation.status === "estimated" && evaluation.weightEstimated)).toBe(true)
  })

  it("asks for each box's weight when the document does not say whether the weight is per box or for all", () => {
    const boxes = expandMarkRange(line({ sku: "S-1 to S-2", quantity: "2", weight: "80", weightScope: "unclear" }))
    expect(boxes.every((entry) => entry.weight === "" && entry.estimatedWeight === "" && entry.checks.length > 0)).toBe(true)
  })
})

describe("packages and what is in them", () => {
  it("keeps the number of packages apart from the number of products inside", () => {
    const [crate] = review([rawLine({ reference: "C-1", description: "Valves", combinedSize: "1 x 1 x 1 m", quantity: "2", contentsQuantity: "500 pcs", grossWeight: "300 kg", weightScope: "per_piece" })]).lines
    expect(crate!.quantity).toBe("2")
    expect(crate!.contentsQuantity).toBe("500 pcs")
    expect(evaluateLine(crate!).pieces).toBe(2)
  })

  it("names a line by its package type and its contents, without repeating the type", () => {
    const [a, b, c] = review([
      rawLine({ packageType: "wooden case", description: "Hydraulic press" }),
      rawLine({ packageType: "pallet", description: "Pallet of tiles" }),
      rawLine({ packageType: "drum", description: null }),
    ]).lines
    expect(a!.name).toBe("Wooden case – Hydraulic press")
    expect(b!.name).toBe("Pallet of tiles")
    expect(c!.name).toBe("Drum")
  })
})

describe("units as the document has them", () => {
  it("keeps the document's size unit and shows the sizes in it", () => {
    const [crate] = review([rawLine({ description: "Crate", length: "1200", width: "800", height: "600", sizeUnit: "mm", quantity: "1" })]).lines
    expect(crate!.sizeUnit).toBe("mm")
    expect(crate!.length).toBe("1200")
    expect(displayDimension(crate!, "length", "mm").text).toBe("1200")
    // The existing unit controls still convert for display.
    expect(displayDimension(crate!, "length", "cm").text).toBe("120")
    expect(evaluateLine(crate!).sizesCm).toEqual([120, 80, 60])
  })
})

describe("cargo volume", () => {
  it("is worked out whether or not a weight is known", () => {
    const evaluation = evaluateLine(line({ quantity: "2", weight: "" }))
    expect(evaluation.volumeM3).toBeCloseTo(1.152, 6)
    expect(summarize([line({ quantity: "2" })], [evaluation]).volumeM3).toBeCloseTo(1.152, 6)
  })
})

describe("what the document says for the whole shipment", () => {
  it("reads packages, products, net, gross and volume", () => {
    const result = review([rawLine({ description: "Crate" })], {
      documentTotals: { pieces: "6 packages", productQuantity: "1,200 pcs", grossWeight: "1,450 kg", netWeight: "1,300 kg", volume: "4.8 CBM", weightUnit: null },
    })
    expect(result.documentTotals).toEqual({ pieces: 6, weightKg: 1450, netKg: 1300, productQuantity: "1,200 pcs", volumeM3: 4.8 })
  })

  it("is left out when the document states none of it", () => {
    expect(review([rawLine({ description: "Crate" })], { documentTotals: { pieces: null, productQuantity: null, grossWeight: null, netWeight: null, volume: null, weightUnit: null } }).documentTotals).toBeNull()
  })
})

describe("warnings only for real doubts", () => {
  it("raises nothing for a line whose fields are all labelled in the document", () => {
    const [crate] = review([
      rawLine({ reference: "C-1", description: "Crate", combinedSize: "120 x 80 x 60 cm", quantity: "4", grossWeight: "150 kg", netWeight: "130 kg", weightScope: "per_piece", stackable: true }),
    ]).lines
    const evaluation = evaluateLine(crate!)
    expect(evaluation.status).toBe("ready")
    expect(evaluation.issues).toEqual([])
    expect(evaluation.notes.filter((note) => note.code === "weight-estimated")).toEqual([])
    expect(crate!.checks).toEqual([])
  })
})

describe("stacking is never assumed", () => {
  it("plans a line whose stacking is not stated as not stackable, and says so", () => {
    const [crate] = review([rawLine({ description: "Crate", combinedSize: "1 x 1 x 1 m", quantity: "1", grossWeight: "10 kg", weightScope: "per_piece" })]).lines
    expect(crate!.stackable).toBeNull()
    const evaluation = evaluateLine(crate!)
    expect(evaluation.stackableNotStated).toBe(true)
    expect(evaluation.input?.stackable).toBe(false)
  })

  it("keeps it not stated on a draft too, and uses a stated value as it is", () => {
    const draft = line({ weight: "", stackable: null })
    expect(toDraft(draft, evaluateLine(draft))?.input.stackable).toBe(false)
    const stated = evaluateLine(line({ weight: "10", stackable: true }))
    expect(stated.stackableNotStated).toBe(false)
    expect(stated.input?.stackable).toBe(true)
  })
})

describe("estimated weights from the document's total gross weight", () => {
  const twoAlike = () => [line({ id: "a", sku: "A" }), line({ id: "b", sku: "B" })]

  it("offers an equal share of the total for packages without a weight", () => {
    const lines = twoAlike()
    const suggestion = suggestWeightDistribution(lines, lines.map(evaluateLine), 300)!
    expect([...suggestion.estimates.values()]).toEqual(["150", "150"])
    expect(suggestion.sameSize).toBe(true)
    expect(suggestion.residualKg).toBe(0)
    expect(suggestion.basis).toContain("300 kg")
  })

  it("shares an uneven total so that the parts add back up to it exactly", () => {
    const lines = [line({ id: "a" }), line({ id: "b" }), line({ id: "c" })]
    const suggestion = suggestWeightDistribution(lines, lines.map(evaluateLine), 100)!
    const applied = applyWeightEstimates(lines, suggestion)
    expect(hundredths(kgOf(applied))).toBe(10000)
    expect(suggestion.residualKg).toBe(0)
  })

  it("keeps the total with lines of several packages, and only reports what rounding cannot place", () => {
    const lines = [line({ id: "a", quantity: "3" }), line({ id: "b", quantity: "1" })]
    const suggestion = suggestWeightDistribution(lines, lines.map(evaluateLine), 100.01)!
    const applied = applyWeightEstimates(lines, suggestion)
    expect(hundredths(kgOf(applied), [3, 1]) + Math.round(suggestion.residualKg * 100)).toBe(10001)
  })

  it("subtracts the weights other lines do give", () => {
    const lines = [line({ id: "a", weight: "100" }), line({ id: "b" }), line({ id: "c" })]
    const suggestion = suggestWeightDistribution(lines, lines.map(evaluateLine), 300)!
    expect(suggestion.estimates.has("a")).toBe(false)
    expect([...suggestion.estimates.values()]).toEqual(["100", "100"])
  })

  it("warns when the packages differ in size", () => {
    const lines = [line({ id: "a" }), line({ id: "b", length: "200" })]
    expect(suggestWeightDistribution(lines, lines.map(evaluateLine), 300)!.sameSize).toBe(false)
  })

  it("offers nothing without a total, or when another weight is itself in doubt", () => {
    const lines = twoAlike()
    expect(suggestWeightDistribution(lines, lines.map(evaluateLine), null)).toBeNull()
    const doubtful = [line({ id: "a", weight: "200", quantity: "2", weightScope: "unclear" }), line({ id: "b" })]
    expect(suggestWeightDistribution(doubtful, doubtful.map(evaluateLine), 300)).toBeNull()
  })

  it("shows an applied estimate as an estimate until the planner confirms it", () => {
    const lines = twoAlike()
    const applied = applyWeightEstimates(lines, suggestWeightDistribution(lines, lines.map(evaluateLine), 300)!)
    const before = applied.map(evaluateLine)
    expect(before.map((evaluation) => evaluation.status)).toEqual(["estimated", "estimated"])
    expect(before.every((evaluation) => evaluation.origins.weight === "estimated" && evaluation.weightEstimated && evaluation.perPieceKg === 150)).toBe(true)
    expect(before.every(isImportable)).toBe(true)
    expect(summarize(applied, before).estimatedWeightLines).toBe(2)

    const accepted = acceptWeightEstimates(applied, new Set(["a"])).map(evaluateLine)
    expect(accepted.map((evaluation) => evaluation.status)).toEqual(["corrected", "estimated"])
    expect(accepted[0]!.origins.weight).toBe("user")
    expect(accepted[0]!.weightEstimated).toBe(false)

    expect(clearWeightEstimates(applied).map(evaluateLine).map((evaluation) => evaluation.status)).toEqual(["missing", "missing"])
  })
})

describe("a load plan needs confirmed weights", () => {
  it("lists the lines whose weight is still the import's estimate", () => {
    const cargo = [
      { id: "a", weightKg: 150, weightEstimate: { perPieceKg: 150, basis: "equal share" } },
      { id: "b", weightKg: 160, weightEstimate: { perPieceKg: 150, basis: "equal share" } },
      { id: "c", weightKg: 200, weightEstimate: null },
      { id: "d", weightKg: 200 },
    ]
    expect(linesNeedingWeightConfirmation(cargo).map((entry) => entry.id)).toEqual(["a"])
  })
})

describe("a box summary with only a total gross weight", () => {
  const document = () =>
    review([rawLine({ reference: "S-1 to S-6", packageType: "6-ply box", description: "Flanges", combinedSize: "96 x 96 x 107 cm", quantity: "6" })], {
      documentTotals: { pieces: "6", productQuantity: "480 pcs", grossWeight: "6,849.999", netWeight: null, volume: null, weightUnit: "kg" },
    })

  it("fills each identical box with an equal share straight away, as an estimate", () => {
    const result = document()
    const lines = withSuggestedEstimates(result.lines, result.documentTotals)
    expect(lines).toHaveLength(6)
    const evaluations = lines.map(evaluateLine)
    expect(evaluations.every((evaluation) => evaluation.status === "estimated" && evaluation.perPieceKg! > 1141.6 && evaluation.perPieceKg! < 1141.7)).toBe(true)
    expect(evaluations.every(isImportable)).toBe(true)
    // The shares add up to the stated total (to the hundredth of a kilogram the shares are kept in).
    expect(hundredths(kgOf(lines))).toBe(685000)
    expect(lines[0]!.estimateBasis).toContain("6849.999 kg over 6 packages")
  })

  it("only offers the split when the boxes differ in size, and never overrides weights or estimates already there", () => {
    const mixed = [line({ id: "a" }), line({ id: "b", length: "200" })]
    expect(withSuggestedEstimates(mixed, { pieces: 2, weightKg: 300 })).toBe(mixed)
    const weighed = [line({ id: "a", weight: "100" }), line({ id: "b", weight: "200" })]
    expect(withSuggestedEstimates(weighed, { pieces: 2, weightKg: 300 })).toBe(weighed)
    const estimated = [line({ id: "a", estimatedWeight: "120", estimateBasis: "x" }), line({ id: "b" })]
    expect(withSuggestedEstimates(estimated, { pieces: 2, weightKg: 300 })).toBe(estimated)
    expect(withSuggestedEstimates([line()], null)).toHaveLength(1)
  })
})

describe("a total printed without its unit", () => {
  const totals = (grossWeight: string, weightUnit: NonNullable<RawExtraction["documentTotals"]>["weightUnit"] = null, lineUnit: RawLine["weightUnit"] = null) =>
    review([rawLine({ description: "Box", weightUnit: lineUnit })], { documentTotals: { pieces: null, productQuantity: null, grossWeight, netWeight: null, volume: null, weightUnit } })

  it("takes the unit from the heading the reader reports", () => {
    expect(totals("6,849.999", "kg").documentTotals?.weightKg).toBe(6849.999)
  })

  it("otherwise takes the unit the lines state", () => {
    expect(totals("6,849.999", null, "kg").documentTotals?.weightKg).toBe(6849.999)
  })

  it("reads a unit written before the number", () => {
    expect(totals("KGS 6,849.999").documentTotals?.weightKg).toBe(6849.999)
  })

  it("never guesses a unit, and says why the total could not be used", () => {
    const result = totals("6,849.999")
    expect(result.documentTotals).toBeNull()
    expect(result.notes.some((note) => note.includes("total gross weight") && note.includes("6,849.999"))).toBe(true)
  })
})
