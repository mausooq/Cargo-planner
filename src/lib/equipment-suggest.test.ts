import { describe, expect, it } from "vitest"
import { solve } from "@compass/solver"
import type { CargoLine } from "@/components/cargo-grid"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { couldHoldSomething, rankSuggestions, suggestEquipment, unitBudget, type EquipmentSuggestion } from "@/lib/equipment-suggest"
import { emptyContour } from "@/lib/uld-contour"

function equipment(id: string, lengthCm: number, widthCm: number, heightCm: number, maxPayloadKg: number, costPerUnit = 0): EquipmentListItem {
  return {
    id,
    externalId: null,
    mode: "SEA",
    name: id,
    code: id,
    sizeLabel: null,
    innerLengthCm: lengthCm,
    innerWidthCm: widthCm,
    innerHeightCm: heightCm,
    heightOpen: false,
    maxPayloadKg,
    tareKg: 2000,
    grossKg: maxPayloadKg + 2000,
    floors: 1,
    axleGroups: [],
    costPerUnit,
    oogClass: "NONE",
    extendable: false,
    maxExtendedLengthCm: null,
    notes: null,
    isCustom: false,
    contour: emptyContour(),
    doorWidthCm: null,
    doorHeightCm: null,
    projectCount: 0,
  }
}

function cargo(id: string, size: [number, number, number], weightKg: number, quantity: number): CargoLine {
  return {
    id,
    updatedAt: "2026-11-20T00:00:00.000Z",
    sku: null,
    name: id,
    lengthCm: size[0],
    widthCm: size[1],
    heightCm: size[2],
    weightKg,
    quantity,
    shape: "BOX",
    orientation: "ROTATE_90",
    allowedRotations: null,
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
  }
}

const box20 = equipment("20ft", 590, 235, 239, 28000)
const box40 = equipment("40ft", 1203, 235, 239, 26000)
const pallet = equipment("pallet", 120, 80, 150, 1000)
const run = async (input: Parameters<typeof solve>[0]) => solve(input)

function suggestion(partial: Partial<EquipmentSuggestion> & Pick<EquipmentSuggestion, "name">): EquipmentSuggestion {
  return {
    equipmentTypeId: partial.name,
    units: 1,
    unloadedPieces: 0,
    totalPieces: 10,
    avgVolumePct: 50,
    avgWeightPct: 10,
    totalCost: 0,
    specialist: false,
    reason: "",
    ...partial,
  }
}

describe("rankSuggestions", () => {
  it("puts types that load everything ahead of types that leave cargo behind", () => {
    const ranked = rankSuggestions(
      [suggestion({ name: "leaves-two", units: 1, unloadedPieces: 2 }), suggestion({ name: "takes-all", units: 3 })],
      "FEWEST_UNITS",
    )
    expect(ranked.map((entry) => entry.name)).toEqual(["takes-all", "leaves-two"])
  })

  it("prefers fewer units, then the tighter fit", () => {
    const ranked = rankSuggestions(
      [
        suggestion({ name: "two-units", units: 2, avgVolumePct: 90 }),
        suggestion({ name: "one-loose", units: 1, avgVolumePct: 35 }),
        suggestion({ name: "one-snug", units: 1, avgVolumePct: 80 }),
      ],
      "FEWEST_UNITS",
    )
    expect(ranked.map((entry) => entry.name)).toEqual(["one-snug", "one-loose", "two-units"])
  })

  it("breaks a tie on units with the cheaper type, so a dry van beats a fuller reefer", () => {
    const ranked = rankSuggestions(
      [
        suggestion({ name: "reefer", units: 1, avgVolumePct: 75, totalCost: 1650 }),
        suggestion({ name: "dry-van", units: 1, avgVolumePct: 61, totalCost: 850 }),
        suggestion({ name: "no-price", units: 2, avgVolumePct: 90 }),
      ],
      "FEWEST_UNITS",
    )
    expect(ranked.map((entry) => entry.name)).toEqual(["dry-van", "reefer", "no-price"])
  })

  it("keeps specialist equipment behind standard types unless only it takes everything", () => {
    const rollTrailer = suggestion({ name: "roll-trailer", units: 1, totalCost: 700, specialist: true })
    const dryVan = suggestion({ name: "dry-van", units: 1, totalCost: 850 })
    expect(rankSuggestions([rollTrailer, dryVan], "FEWEST_UNITS")[0]?.name).toBe("dry-van")
    expect(rankSuggestions([rollTrailer, dryVan], "LOWEST_COST")[0]?.name).toBe("dry-van")
    // Oversize cargo: the dry van leaves a piece behind, so the specialist leads.
    const ranked = rankSuggestions([rollTrailer, { ...dryVan, unloadedPieces: 1 }], "FEWEST_UNITS")
    expect(ranked[0]?.name).toBe("roll-trailer")
  })

  it("ranks by total cost for the lowest-cost objective when every type has a cost", () => {
    const ranked = rankSuggestions(
      [suggestion({ name: "one-pricey", units: 1, totalCost: 3000 }), suggestion({ name: "two-cheap", units: 2, totalCost: 2000 })],
      "LOWEST_COST",
    )
    expect(ranked[0]?.name).toBe("two-cheap")
  })

  it("drops types that loaded nothing and explains each result", () => {
    const ranked = rankSuggestions([suggestion({ name: "empty", units: 0 }), suggestion({ name: "ok", units: 2, avgVolumePct: 71.6 })], "FEWEST_UNITS")
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.reason).toBe("Fits all 10 pieces in 2 units, about 72% full.")
  })
})

describe("helpers", () => {
  it("screens out types no piece can physically enter", () => {
    const long = [cargo("pipe", [500, 30, 30], 100, 1)]
    expect(couldHoldSomething(box20, long)).toBe(true)
    expect(couldHoldSomething(pallet, long)).toBe(false)
  })

  it("budgets more units for smaller types, within limits", () => {
    const lines = [cargo("crate", [100, 100, 100], 100, 60)]
    expect(unitBudget(box40, lines)).toBeLessThan(unitBudget(box20, lines))
    expect(unitBudget(pallet, lines)).toBeLessThanOrEqual(60)
  })
})

describe("suggestEquipment (real solver)", () => {
  it("recommends the 20ft when it takes everything in one well-filled unit", async () => {
    // 20 one-metre cubes fill a 20ft exactly (5 × 2 × 2).
    const ranked = await suggestEquipment({
      cargo: [cargo("cube", [100, 100, 100], 100, 20)],
      candidates: [box40, box20, pallet],
      objective: "FEWEST_UNITS",
      run,
    })
    expect(ranked[0]).toMatchObject({ name: "20ft", units: 1, unloadedPieces: 0 })
    expect(ranked[0]?.avgVolumePct).toBeGreaterThan(ranked.find((entry) => entry.name === "40ft")?.avgVolumePct ?? 100)
  })

  it("recommends the 40ft when the 20ft would need two units", async () => {
    const ranked = await suggestEquipment({
      cargo: [cargo("cube", [100, 100, 100], 100, 36)],
      candidates: [box20, box40],
      objective: "FEWEST_UNITS",
      run,
    })
    expect(ranked.map((entry) => [entry.name, entry.units])).toEqual([
      ["40ft", 1],
      ["20ft", 2],
    ])
  })

  it("reports progress and can be cancelled", async () => {
    const seen: number[] = []
    let cancelled = false
    const ranked = await suggestEquipment({
      cargo: [cargo("cube", [100, 100, 100], 100, 4)],
      candidates: [box20, box40],
      objective: "FEWEST_UNITS",
      run,
      onProgress: (progress) => {
        seen.push(progress.done)
        // Cancel during the first trial: that one finishes, the second never starts.
        cancelled = true
      },
      isCancelled: () => cancelled,
    })
    expect(seen[0]).toBe(0)
    expect(ranked).toHaveLength(1)
  })
})
