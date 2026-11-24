import { cargoItemInputSchema } from "@compass/domain"
import { describe, expect, it } from "vitest"
import {
  cargoExtractionSchema,
  documentKind,
  extractionToCargo,
  isSpreadsheetFile,
  MAX_EXTRACTED_LINES,
  type CargoExtraction,
} from "@/lib/cargo-extract"
import { fitWithin } from "@/lib/shrink-image"

type Item = CargoExtraction["items"][number]

function item(overrides: Partial<Item> = {}): Item {
  return {
    reference: "S-1",
    name: "Flange box",
    lengthCm: 96,
    widthCm: 96,
    heightCm: 107,
    weightKg: 1141.6665,
    quantity: 1,
    shape: "BOX",
    stackable: null,
    ...overrides,
  }
}

function extraction(items: Item[], notes: string[] = []): CargoExtraction {
  return { summary: " Packing list for flanges. ", items, notes }
}

describe("document kinds", () => {
  it("recognises PDFs and images by type or by file name", () => {
    expect(documentKind("list.pdf", "")).toEqual({ kind: "pdf" })
    expect(documentKind("scan", "application/pdf")).toEqual({ kind: "pdf" })
    expect(documentKind("photo.JPG", "")).toEqual({ kind: "image", mediaType: "image/jpeg" })
    expect(documentKind("image.png", "image/png")).toEqual({ kind: "image", mediaType: "image/png" })
  })

  it("leaves spreadsheets and unknown files to the other import path", () => {
    expect(documentKind("cargo.xlsx", "")).toBeNull()
    expect(documentKind("notes.docx", "")).toBeNull()
    expect(isSpreadsheetFile("Cargo.XLSX")).toBe(true)
    expect(isSpreadsheetFile("cargo.csv")).toBe(true)
    expect(isSpreadsheetFile("list.pdf")).toBe(false)
  })
})

describe("turning Claude's answer into cargo lines", () => {
  it("maps a complete item onto a valid cargo line", () => {
    const result = extractionToCargo(extraction([item({ stackable: false })], [" Converted from mm. ", ""]))
    expect(result.summary).toBe("Packing list for flanges.")
    expect(result.notes).toEqual(["Converted from mm."])
    expect(result.incomplete).toBe(0)
    expect(result.drafts[0]).toMatchObject({
      sku: "S-1",
      name: "Flange box",
      lengthCm: 96,
      widthCm: 96,
      heightCm: 107,
      weightKg: 1141.67,
      quantity: 1,
      shape: "BOX",
      orientation: "ROTATE_90",
      stackable: false,
    })
    expect(cargoItemInputSchema.safeParse(result.drafts[0]).success).toBe(true)
  })

  it("keeps lines with missing values, as zeros, and counts them", () => {
    const result = extractionToCargo(extraction([item(), item({ reference: "S-2", heightCm: null, weightKg: -5 })]))
    expect(result.incomplete).toBe(1)
    expect(result.drafts[1]).toMatchObject({ heightCm: 0, weightKg: 0 })
    expect(cargoItemInputSchema.safeParse(result.drafts[1]).success).toBe(true)
  })

  it("defaults to stackable when the document does not say, and uses drum settings for drums", () => {
    const [box, drum] = extractionToCargo(extraction([item(), item({ shape: "DRUM", stackable: true })])).drafts
    expect(box!.stackable).toBe(true)
    expect(drum).toMatchObject({ shape: "CYLINDER_DRUM", orientation: "FIXED" })
  })

  it("repairs odd quantities and falls back to the mark when there is no name", () => {
    const [a, b] = extractionToCargo(
      extraction([item({ quantity: 2.6 }), item({ name: "  ", reference: "RT3", quantity: 0 })]),
    ).drafts
    expect(a!.quantity).toBe(3)
    expect(b).toMatchObject({ name: "RT3", sku: "RT3", quantity: 1 })
  })

  it("drops lines with neither a name nor a mark, and caps very long lists", () => {
    expect(extractionToCargo(extraction([item({ name: "", reference: null })])).drafts).toHaveLength(0)
    const many = Array.from({ length: MAX_EXTRACTED_LINES + 5 }, (_, index) => item({ reference: `P-${index}` }))
    const result = extractionToCargo(extraction(many))
    expect(result.drafts).toHaveLength(MAX_EXTRACTED_LINES)
    expect(result.notes.at(-1)).toContain("only the first")
  })

  it("accepts the answer shape Claude is asked for", () => {
    expect(cargoExtractionSchema.safeParse(extraction([item()], ["A note."])).success).toBe(true)
    expect(cargoExtractionSchema.safeParse({ items: [] }).success).toBe(false)
  })
})

describe("shrinking photos", () => {
  it("fits the longest side and keeps the shape", () => {
    expect(fitWithin(4800, 3600, 2400)).toEqual({ width: 2400, height: 1800 })
    expect(fitWithin(1000, 4000, 2400)).toEqual({ width: 600, height: 2400 })
  })

  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600, 2400)).toEqual({ width: 800, height: 600 })
  })
})
