import { cargoItemInputSchema } from "@compass/domain"
import { floorUtilization } from "@compass/physics"
import { solve, type SolverCargo, type SolverEquipment } from "@compass/solver"
import { describe, expect, it } from "vitest"
import {
  importMappingSchema,
  readDimensionHeader,
  suggestLengthUnit,
  suggestMapping,
  toCentimetres,
  type ImportMapping,
} from "@/lib/cargo-import"
import { buildImportPreview } from "@/lib/import-table"
import { CARGO_EXPORT_HEADERS, cargoExportHeaders, cargoExportRows } from "@/lib/cargo-export"
import {
  CM_PER_UNIT,
  displayLengthText,
  feetAndInches,
  formatLengthIn,
  fromDisplayLength,
  interpretLengthEdit,
  isLengthUnit,
  LENGTH_UNITS,
  lengthCellText,
  lengthUnitFromWord,
  parseLength,
  roundStoredCm,
  sameStoredLength,
  toDisplayLength,
  type LengthUnit,
} from "@/lib/cargo-units"
import { cargoTotals } from "@/lib/cargo-validation"
import { formatCm, formatEnvelope } from "@/lib/format"
import { metricBoxesOf } from "@/lib/plan-metrics"
import { derivePlanStatus } from "@/lib/plan-status"
import { cargoSignature, planStaleness } from "@/lib/plan-staleness"
import { noteRows, packingRows, summaryRows } from "@/lib/plan-export"
import { toPlanView, type PlanView } from "@/lib/plan-view"

const cmOf = (text: string, unit: LengthUnit = "cm") => {
  const parsed = parseLength(text, unit)
  if (!parsed.ok) throw new Error(`could not read ${text}: ${parsed.reason}`)
  return parsed.cm
}

describe("conversion between every supported unit", () => {
  const MM_PER_UNIT: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

  it("supports millimetres, centimetres, metres, inches and feet, and keeps the earlier units", () => {
    expect([...LENGTH_UNITS].sort()).toEqual(["cm", "ft", "in", "m", "mm"])
    for (const unit of ["cm", "in", "m"]) expect(isLengthUnit(unit)).toBe(true)
    expect(isLengthUnit("yd")).toBe(false)
    expect(isLengthUnit(null)).toBe(false)
  })

  it("converts every unit to every other correctly, in both directions", () => {
    for (const from of LENGTH_UNITS) {
      for (const to of LENGTH_UNITS) {
        const value = 12.5
        const viaCm = toDisplayLength(fromDisplayLength(value, from), to)
        expect(viaCm).toBeCloseTo((value * MM_PER_UNIT[from]) / MM_PER_UNIT[to], 9)
      }
    }
  })

  it("knows the exact factors", () => {
    expect(CM_PER_UNIT).toEqual({ mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 })
    expect(fromDisplayLength(1, "ft")).toBeCloseTo(30.48, 10)
    expect(fromDisplayLength(12, "in")).toBeCloseTo(fromDisplayLength(1, "ft"), 10)
    expect(fromDisplayLength(1000, "mm")).toBeCloseTo(fromDisplayLength(1, "m"), 10)
    expect(toDisplayLength(304.8, "ft")).toBeCloseTo(10, 10)
  })

  it("uses the same conversion for the importer as for the grid", () => {
    for (const unit of LENGTH_UNITS) expect(toCentimetres(7.25, unit)).toBe(roundStoredCm(fromDisplayLength(7.25, unit)))
    expect(toCentimetres(10, "mm")).toBe(1)
    expect(toCentimetres(1, "in")).toBe(2.54)
    expect(toCentimetres(1.2, "m")).toBe(120)
    expect(toCentimetres(2, "ft")).toBe(60.96)
  })
})

describe("reading a typed size", () => {
  it("reads a plain number in the chosen unit", () => {
    expect(cmOf("120")).toBe(120)
    expect(cmOf("1200", "mm")).toBe(120)
    expect(cmOf("1.2", "m")).toBe(120)
    expect(cmOf("10", "in")).toBe(25.4)
    expect(cmOf("4", "ft")).toBe(121.92)
  })

  it("reads decimal feet as decimal feet, never as feet and inches", () => {
    expect(cmOf("5.6", "ft")).toBe(roundStoredCm(5.6 * 30.48))
    expect(cmOf("5.6", "ft")).not.toBeCloseTo(cmOf("5 ft 6 in"), 1)
    expect(cmOf("5.5 ft")).toBe(167.64)
    expect(cmOf("5,5", "ft")).toBe(167.64)
    expect(cmOf(".5", "ft")).toBe(15.24)
  })

  it("reads feet and inches written out, in every common form", () => {
    for (const text of ["5 ft 6 in", "5ft6in", "5 feet 6 inches", `5'6"`, `5' 6"`, `5'6`, `5’6”`, "5 FT 6 IN", "5 ft 6\""]) {
      expect(cmOf(text), text).toBe(167.64)
    }
    expect(cmOf("5 ft 6.5 in")).toBe(roundStoredCm((5 * 12 + 6.5) * 2.54))
    expect(cmOf(`5'`)).toBe(152.4)
    expect(cmOf(`0'6"`)).toBe(15.24)
    expect(cmOf(`6"`)).toBe(15.24)
  })

  it("reads feet and inches whatever unit is selected, because the text says what it is", () => {
    for (const unit of LENGTH_UNITS) expect(cmOf(`5'6"`, unit)).toBe(167.64)
    expect(cmOf("1200 mm", "ft")).toBe(120)
    expect(cmOf("3 ft", "cm")).toBe(91.44)
  })

  it("rejects what cannot be a size, with a reason", () => {
    for (const text of ["", "   ", "abc", "-5", "-5 ft", "1.2.3", "5 xyz", "5 ft 6", "NaN", "Infinity", `5'6"7`, "ft", "5.5 ft 3 in", "5 6"]) {
      const parsed = parseLength(text, "cm")
      expect(parsed.ok, text).toBe(false)
      if (!parsed.ok) expect(parsed.reason.length).toBeGreaterThan(0)
    }
  })

  it("refuses inches of a foot or more, which are most likely a typing slip", () => {
    for (const text of ["5 ft 14 in", `5'12"`, `5'13`]) {
      const parsed = parseLength(text, "cm")
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toMatch(/under 12/)
    }
    expect(cmOf(`5'11.9"`)).toBeCloseTo((5 * 12 + 11.9) * 2.54, 3)
  })

  it("reads unit words", () => {
    expect(lengthUnitFromWord("Feet")).toBe("ft")
    expect(lengthUnitFromWord("inches")).toBe("in")
    expect(lengthUnitFromWord("metres")).toBe("m")
    expect(lengthUnitFromWord("yards")).toBeNull()
  })

  it("describes feet and inches back, and sizes with their unit", () => {
    expect(feetAndInches(167.64)).toBe("5 ft 6 in")
    expect(feetAndInches(152.4)).toBe("5 ft 0 in")
    expect(feetAndInches(182.8)).toBe("6 ft 0 in")
    expect(formatLengthIn(167.64, "ft")).toBe("5.5 ft")
    expect(formatLengthIn(120, "cm")).toBe("120 cm")
    expect(formatLengthIn(1203, "m")).toBe("12.03 m")
    expect(formatCm(120)).toBe("120 cm")
    expect(formatCm(167.64, "ft")).toBe("5.5 ft")
    expect(formatEnvelope(120, 80, 60)).toBe("120 × 80 × 60 cm")
    expect(formatEnvelope(304.8, 152.4, 91.44, "ft")).toBe("10 × 5 × 3 ft")
    expect(lengthCellText(120.4, "cm")).toBe("120")
    expect(lengthCellText(167.64, "ft")).toBe("5.5")
  })
})

describe("switching the displayed unit never changes what is stored", () => {
  const stored = 117.3333

  it("shows the same stored value in every unit and back, without ever writing", () => {
    const cm = stored
    for (let cycle = 0; cycle < 60; cycle += 1) {
      for (const unit of ["ft", "cm", "in", "m", "mm", "ft", "cm"] as const) {
        const shown = displayLengthText(cm, unit)
        // Looking at the number, clicking in and out of the box, or typing back exactly what is shown, changes nothing.
        expect(interpretLengthEdit(shown, unit, cm).kind).toBe("same")
      }
    }
    expect(cm).toBe(stored)
  })

  it("would lose precision if the shown figure were written back, which is why it never is", () => {
    const shownInFeet = displayLengthText(stored, "ft")
    expect(cmOf(shownInFeet, "ft")).not.toBe(stored)
    expect(interpretLengthEdit(shownInFeet, "ft", stored).kind).toBe("same")
  })

  it("a deliberate edit while feet is selected changes the stored value to the exact centimetres", () => {
    const edit = interpretLengthEdit("4.5", "ft", stored)
    expect(edit).toEqual({ kind: "changed", cm: 137.16 })
    expect(interpretLengthEdit(`4'6"`, "ft", stored)).toEqual({ kind: "changed", cm: 137.16 })
    expect(interpretLengthEdit("", "ft", stored)).toEqual({ kind: "blank" })
    expect(interpretLengthEdit("oops", "ft", stored).kind).toBe("invalid")
    expect(interpretLengthEdit("-3", "ft", stored).kind).toBe("invalid")
  })

  it("treats values that agree to the stored precision as the same", () => {
    expect(sameStoredLength(117.33330001, 117.3333)).toBe(true)
    expect(sameStoredLength(117.3334, 117.3333)).toBe(false)
    expect(roundStoredCm(167.64000000000001)).toBe(167.64)
  })

  it("rounds only for showing: display text is short, stored values are not", () => {
    expect(displayLengthText(117.3333, "ft")).toBe("3.85")
    expect(displayLengthText(117.3333, "cm")).toBe("117.3")
    expect(displayLengthText(0, "ft")).toBe("")
    expect(roundStoredCm(117.3333)).toBe(117.3333)
  })
})

describe("the same cargo entered in different units is the same cargo", () => {
  // 5 x 3 x 2 ft, written in every unit.
  const entries: Record<LengthUnit, [string, string, string]> = {
    mm: ["1524", "914.4", "609.6"],
    cm: ["152.4", "91.44", "60.96"],
    m: ["1.524", "0.9144", "0.6096"],
    in: ["60", "36", "24"],
    ft: ["5", "3", "2"],
  }
  const asLine = (unit: LengthUnit) => {
    const [l, w, h] = entries[unit].map((text) => cmOf(text, unit)) as [number, number, number]
    return { lengthCm: l, widthCm: w, heightCm: h }
  }

  it("gives identical stored sizes whichever unit they were typed in", () => {
    const reference = asLine("cm")
    for (const unit of LENGTH_UNITS) expect(asLine(unit), unit).toEqual(reference)
  })

  const container: SolverEquipment = { id: "c", name: "Box", lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000, tareKg: 100, axleGroups: [], costPerUnit: 1, maxCount: 1 }
  const cargoFor = (unit: LengthUnit): SolverCargo => ({
    id: "a",
    name: "a",
    ...asLine(unit),
    weightKg: 80,
    quantity: 9,
    shape: "BOX",
    orientation: "ROTATE_90",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
  })

  it("packs identically: same positions, rotations, volume and floor figures", () => {
    const base = solve({ equipment: [container], cargo: [cargoFor("cm")], settings: { restarts: 4 } })
    for (const unit of LENGTH_UNITS) {
      const result = solve({ equipment: [container], cargo: [cargoFor(unit)], settings: { restarts: 4 } })
      expect(result.units, unit).toEqual(base.units)
      expect(result.unloaded).toEqual(base.unloaded)
    }
    const metrics = base.units[0]!.metrics
    expect(metrics.volumeM3).toBeCloseTo(9 * 1.524 * 0.9144 * 0.6096, 2)
    expect(metrics.floorPct).toBeGreaterThan(0)
  })

  it("has the same volume and weight totals", () => {
    const totals = (unit: LengthUnit) => cargoTotals([{ ...cargoFor(unit), sku: null, allowedRotations: null } as never])
    for (const unit of LENGTH_UNITS) {
      expect(totals(unit).volumeM3).toBeCloseTo(totals("cm").volumeM3, 9)
      expect(totals(unit).weightKg).toBe(totals("cm").weightKg)
    }
  })

  it("has the same floor figures when laid out the same way", () => {
    const layout = (unit: LengthUnit) => {
      const line = asLine(unit)
      return [0, 1, 2].map((index) => ({ id: `p${index}`, x: index * (line.lengthCm + 10), y: 0, z: 0, l: line.lengthCm, w: line.widthCm, h: line.heightCm }))
    }
    const reference = floorUtilization(layout("cm"), { lengthCm: 600, widthCm: 240 })
    for (const unit of LENGTH_UNITS) expect(floorUtilization(layout(unit), { lengthCm: 600, widthCm: 240 })).toEqual(reference)
  })
})

describe("the plan's status does not depend on the display unit", () => {
  const row = (unit: LengthUnit) => {
    const text = unit === "ft" ? ["5", "3", "2"] : ["152.4", "91.44", "60.96"]
    const [l, w, h] = text.map((value) => cmOf(value, unit)) as [number, number, number]
    return { id: "a", lengthCm: l, widthCm: w, heightCm: h, weightKg: 10, quantity: 2, shape: "BOX", orientation: "ANY", customFields: null }
  }

  it("the same cargo has the same signature whichever unit it was typed in, so the plan is not outdated by a unit switch", () => {
    expect(cargoSignature([row("ft")])).toBe(cargoSignature([row("cm")]))
    const plan = { createdAt: new Date("2026-11-01"), settings: { cargoSignature: cargoSignature([row("cm")]) } }
    expect(planStaleness(plan, [row("ft")])).toBeNull()
    expect(derivePlanStatus({ hasPlan: true, calculating: false, stale: planStaleness(plan, [row("ft")]) !== null, failed: false }).kind).toBe("ready")
  })

  it("a real change of a physical size still makes the plan out of date, however it was typed", () => {
    const plan = { createdAt: new Date("2026-11-01"), settings: { cargoSignature: cargoSignature([row("cm")]) } }
    const taller = { ...row("ft"), heightCm: cmOf("2.5", "ft") }
    expect(planStaleness(plan, [taller])).toBe("cargo")
  })
})

describe("packing list import", () => {
  const sheet = (headers: string[], rows: string[][]) => ({ headers, rows })
  const mappingFor = (headers: string[], lengthUnit: LengthUnit): ImportMapping => ({ lengthUnit, weightUnit: "kg", columns: suggestMapping(headers) })

  it("recognises units written in the size column titles", () => {
    expect(readDimensionHeader("Length (ft)")).toEqual({ field: "length", unit: "ft" })
    expect(readDimensionHeader("W - inches")).toEqual({ field: "width", unit: "in" })
    expect(readDimensionHeader("height mm")).toEqual({ field: "height", unit: "mm" })
    expect(readDimensionHeader("Length")).toEqual({ field: "length", unit: null })
    expect(readDimensionHeader("Length (yards)")).toBeNull()
    expect(readDimensionHeader("Weight (kg)")).toBeNull()
  })

  it("takes the unit from the titles only when they say one, and never guesses otherwise", () => {
    const pick = (headers: string[]) => suggestLengthUnit(headers, suggestMapping(headers))
    expect(pick(["Name", "Length (ft)", "Width (ft)", "Height (ft)", "Weight"])).toEqual({ unit: "ft", source: "titles" })
    expect(pick(["Name", "Length (ft)", "Width", "Height", "Weight"])).toEqual({ unit: "ft", source: "titles" })
    expect(pick(["Name", "Length", "Width", "Height", "Weight"])).toEqual({ unit: null, source: "none" })
    expect(pick(["Name", "Length (mm)", "Width (cm)", "Height (ft)", "Weight"])).toEqual({ unit: null, source: "conflict" })
  })

  it("maps size columns whatever unit their title carries, and keeps the earlier aliases", () => {
    expect(suggestMapping(["Length (ft)", "Width (ft)", "Height (ft)"])).toEqual({ "Length (ft)": "length", "Width (ft)": "width", "Height (ft)": "height" })
    expect(suggestMapping(["Length cm", "Length mm"]).hasOwnProperty("Length cm")).toBe(true)
    expect(suggestMapping(["L", "W", "H"])).toEqual({ L: "length", W: "width", H: "height" })
  })

  it("converts feet, feet-and-inches and written units to centimetres, row by row", () => {
    const headers = ["Name", "Length", "Width", "Height", "Weight"]
    const preview = buildImportPreview(
      sheet(headers, [
        ["Crate", "5", "3", "2", "40"],
        ["Pipe", `5'6"`, "3 ft", "1200 mm", "40"],
        ["Box", "1,200", "800", "600", "40"],
      ]),
      mappingFor(headers, "ft"),
    )
    expect(preview.issues).toEqual([])
    expect(preview.drafts.map((draft) => [draft.lengthCm, draft.widthCm, draft.heightCm])).toEqual([
      [152.4, 91.44, 60.96],
      [167.64, 91.44, 120],
      [36576, 24384, 18288],
    ])
  })

  it("reads plain numbers in the chosen unit, so choosing the unit decides ambiguous files", () => {
    const headers = ["Name", "Length", "Width", "Height", "Weight"]
    const rows = [["Crate", "120", "80", "60", "5"]]
    expect(buildImportPreview(sheet(headers, rows), mappingFor(headers, "cm")).drafts[0]).toMatchObject({ lengthCm: 120, widthCm: 80, heightCm: 60 })
    expect(buildImportPreview(sheet(headers, rows), mappingFor(headers, "mm")).drafts[0]).toMatchObject({ lengthCm: 12, widthCm: 8, heightCm: 6 })
    expect(buildImportPreview(sheet(headers, rows), mappingFor(headers, "in")).drafts[0]).toMatchObject({ lengthCm: 304.8, widthCm: 203.2, heightCm: 152.4 })
  })

  it("reports unreadable and zero sizes row by row instead of guessing", () => {
    const headers = ["Name", "Length", "Width", "Height", "Weight"]
    const preview = buildImportPreview(sheet(headers, [["A", "5 ft 14 in", "3", "2", "1"], ["B", "x", "3", "2", "1"], ["C", "0", "3", "2", "1"], ["D", "-4", "3", "2", "1"]]), mappingFor(headers, "ft"))
    expect(preview.drafts).toEqual([])
    expect(preview.issues.map((issue) => [issue.rowNumber, issue.field])).toEqual([[2, "length"], [3, "length"], [4, "length"], [5, "length"]])
    expect(preview.issues[0]!.message).toMatch(/under 12/)
  })

  it("accepts saved mappings from before feet existed, and new ones that use it", () => {
    for (const lengthUnit of ["cm", "mm", "in", "m", "ft"]) {
      expect(importMappingSchema.safeParse({ lengthUnit, weightUnit: "kg", columns: { Length: "length" } }).success, lengthUnit).toBe(true)
    }
    expect(importMappingSchema.safeParse({ lengthUnit: "yd", weightUnit: "kg", columns: {} }).success).toBe(false)
  })
})

describe("export and import round trip", () => {
  const lines = [
    { sku: "A", name: "Crate", lengthCm: 117.3333, widthCm: 77.7, heightCm: 90, weightKg: 12.5, quantity: 3, shape: "BOX", orientation: "ROTATE_90", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null },
    { sku: null, name: "Pipe", lengthCm: 304.8, widthCm: 21.6, heightCm: 21.6, weightKg: 60, quantity: 1, shape: "PIPE", orientation: "ROTATE_90", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null },
  ] as never[]

  it("writes the unit into each size column title, and leaves the centimetre export exactly as it was", () => {
    expect(cargoExportHeaders()).toEqual([...CARGO_EXPORT_HEADERS])
    expect(cargoExportHeaders("cm")).toEqual([...CARGO_EXPORT_HEADERS])
    const feet = cargoExportHeaders("ft")
    expect(feet.slice(2, 5)).toEqual(["Length (ft)", "Width (ft)", "Height (ft)"])
    expect(feet[5]).toBe("Weight (kg)")
    expect(cargoExportRows(lines)[0]!.slice(2, 5)).toEqual([117.3333, 77.7, 90])
    expect(cargoExportRows(lines, "ft")[1]!.slice(2, 5)).toEqual([10, Number((21.6 / 30.48).toPrecision(12)), Number((21.6 / 30.48).toPrecision(12))])
  })

  for (const unit of LENGTH_UNITS) {
    it(`re-imports an export in ${unit} without any unintended unit conversion`, () => {
      const headers = cargoExportHeaders(unit)
      const rows = cargoExportRows(lines, unit).map((row) => row.map(String))
      const columns = suggestMapping(headers)
      const hint = suggestLengthUnit(headers, columns)
      expect(hint).toEqual({ unit, source: "titles" })
      const preview = buildImportPreview({ headers, rows }, { lengthUnit: hint.unit!, weightUnit: "kg", columns })
      expect(preview.issues).toEqual([])
      preview.drafts.forEach((draft, index) => {
        const original = lines[index] as { lengthCm: number; widthCm: number; heightCm: number }
        expect(Math.abs(draft.lengthCm - original.lengthCm)).toBeLessThan(0.0002)
        expect(Math.abs(draft.widthCm - original.widthCm)).toBeLessThan(0.0002)
        expect(Math.abs(draft.heightCm - original.heightCm)).toBeLessThan(0.0002)
        expect(cargoItemInputSchema.safeParse(draft).success).toBe(true)
      })
    })
  }

  it("a feet export read back as centimetres would be wrong, which is exactly what the unit in the title prevents", () => {
    const headers = cargoExportHeaders("ft")
    const rows = cargoExportRows(lines, "ft").map((row) => row.map(String))
    const columns = suggestMapping(headers)
    const wrong = buildImportPreview({ headers, rows }, { lengthUnit: "cm", weightUnit: "kg", columns })
    expect(wrong.drafts[0]!.lengthCm).toBeLessThan(10)
    expect(suggestLengthUnit(headers, columns).unit).toBe("ft")
  })
})

describe("reports state their units", () => {
  const plan = toPlanView(
    {
      seed: 1,
      elapsedMs: 1,
      totalCost: 0,
      warnings: [],
      unloaded: [],
      restartsRun: 1,
      settings: {},
      units: [
        {
          unitIndex: 0,
          equipmentId: "eq",
          metrics: { pieces: 1, netKg: 10, grossKg: 10, volumeM3: 0.84, volumePct: 1, floorPct: 2, weightPct: 1, remainingKg: 990, remainingM3: 50, usedLengthCm: 304.8, usedWidthCm: 152.4, usedHeightCm: 91.44, cog: { x: 0, y: 0, z: 0 }, axleLoads: [] },
          placements: [{ cargoId: "a", instanceIndex: 0, unitIndex: 0, sequence: 1, x: 30.48, y: 15.24, z: 0, lengthCm: 304.8, widthCm: 152.4, heightCm: 91.44, rotation: "LWH", layer: 1 }],
        },
      ],
    } as never,
    [{ id: "eq", name: "Box", mode: "SEA", oogClass: "NONE", heightOpen: false, contour: null, lengthCm: 1000, widthCm: 300, heightCm: 300, maxPayloadKg: 1000 }],
    [{ id: "a", name: "A", weightKg: 10, color: null }],
  ) as PlanView

  it("keeps the centimetre packing list exactly as it was", () => {
    const row = packingRows(plan)[0]!
    expect(row).toMatchObject({ "Length (cm)": 304.8, "Width (cm)": 152.4, "Height (cm)": 91.4, "From front (cm)": 30.5 })
    expect(summaryRows(plan)[0]).toMatchObject({ "Used length (cm)": 305 })
  })

  it("writes sizes and positions in feet with the unit in every title", () => {
    const row = packingRows(plan, "ft")[0]!
    expect(row).toMatchObject({ "Length (ft)": 10, "Width (ft)": 5, "Height (ft)": 3, "From front (ft)": 1, "From left (ft)": 0.5, "From floor (ft)": 0 })
    expect(Object.keys(row).some((key) => key.endsWith("(cm)"))).toBe(false)
    expect(Object.keys(row)).not.toContain("Clearance")
    expect(summaryRows(plan, "ft")[0]).toMatchObject({ "Used length (ft)": 10 })
    // Weights and volumes keep their units.
    expect(row["Weight (kg)"]).toBe(10)
    expect(summaryRows(plan, "ft")[0]).toMatchObject({ "Cargo volume (m³)": 0.84 })
  })

  it("explains the units on the Notes sheet", () => {
    const units = noteRows("ft").find((entry) => entry.Topic === "Units")!
    expect(units.Note).toMatch(/feet \(ft\)/)
    expect(units.Note).not.toMatch(/clearance/i)
    expect(noteRows().find((entry) => entry.Topic === "Units")!.Note).toMatch(/centimetre|cm/)
  })

  it("the layout, and so every other figure, is unchanged by the unit", () => {
    expect(metricBoxesOf(plan.units[0]!.items)).toEqual(metricBoxesOf(plan.units[0]!.items))
    expect(packingRows(plan, "ft")[0]!["Weight (kg)"]).toBe(packingRows(plan, "cm")[0]!["Weight (kg)"])
    expect(displayLengthText(30.48, "ft")).toBe("1")
  })
})
