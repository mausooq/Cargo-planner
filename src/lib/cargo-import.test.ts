import { describe, expect, it } from "vitest"
import { buildImportPreview, suggestMapping, toCentimetres, toKilograms } from "./cargo-import"

describe("cargo unit conversion", () => {
  it("converts millimetres, inches, and pounds into cm and kg", () => {
    expect(toCentimetres(10, "mm")).toBe(1)
    expect(toCentimetres(1, "in")).toBe(2.54)
    expect(toCentimetres(1.2, "m")).toBe(120)
    expect(toCentimetres(120, "cm")).toBe(120)
    expect(toKilograms(1, "lb")).toBe(0.4536)
    expect(toKilograms(18, "kg")).toBe(18)
  })
})

describe("cargo import mapping", () => {
  it("suggests columns from common headers and keeps the first match", () => {
    expect(suggestMapping(["Name", "Length (CM)", "Width", "Height", "Weight", "Qty", "Item"])).toEqual({
      Name: "name",
      "Length (CM)": "length",
      Width: "width",
      Height: "height",
      Weight: "weight",
      Qty: "quantity",
    })
  })

  it("converts a mapped sheet and reports a bad row", () => {
    const headers = ["Name", "L", "W", "H", "Weight", "Shape"]
    const preview = buildImportPreview(
      {
        headers,
        rows: [
          ["Carton", "10", "8", "6", "2", "box"],
          ["", "1", "1", "1", "1", "box"],
          ["Drum", "20", "20", "30", "15", "drum"],
        ],
      },
      {
        lengthUnit: "in",
        weightUnit: "lb",
        columns: suggestMapping(headers),
      },
    )

    expect(preview.drafts).toHaveLength(2)
    expect(preview.drafts[0]).toMatchObject({
      name: "Carton",
      lengthCm: 25.4,
      widthCm: 20.32,
      heightCm: 15.24,
      weightKg: 0.9072,
      shape: "BOX",
      quantity: 1,
    })
    expect(preview.drafts[1]?.shape).toBe("CYLINDER_DRUM")
    expect(preview.issues.some((issue) => issue.rowNumber === 3 && issue.field === "name")).toBe(true)
  })
})
