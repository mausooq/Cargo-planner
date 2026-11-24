import type { CargoItemInput } from "@compass/domain"
import { describe, expect, it } from "vitest"
import { CARGO_EXPORT_HEADERS, cargoExportFileName, cargoExportRows } from "@/lib/cargo-export"
import { buildImportPreview, CARGO_IMPORT_FIELDS, suggestMapping } from "@/lib/cargo-import"

function line(overrides: Partial<CargoItemInput> = {}): CargoItemInput {
  return {
    sku: "S-1",
    name: "Flange box S-1",
    lengthCm: 96,
    widthCm: 96,
    heightCm: 107,
    weightKg: 1141.6665,
    quantity: 1,
    shape: "BOX",
    orientation: "ROTATE_90",
    allowedRotations: null,
    stackable: false,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
    ...overrides,
  }
}

describe("cargo export", () => {
  it("writes one row per line in header order", () => {
    const rows = cargoExportRows([line()])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(CARGO_EXPORT_HEADERS.length)
    expect(rows[0]!.slice(0, 12)).toEqual(["S-1", "Flange box S-1", 96, 96, 107, 1141.6665, 1, "BOX", "ROTATE_90", "no", "yes", "no"])
  })

  it("leaves optional cells blank and names drums the way the import expects", () => {
    const [row] = cargoExportRows([line({ sku: null, shape: "CYLINDER_DRUM", maxStackLoadKg: null, color: null })])
    expect(row![0]).toBe("")
    expect(row![7]).toBe("DRUM")
    expect(row![12]).toBe("")
    expect(row![18]).toBe("")
  })

  it("uses column titles the import wizard maps by itself", () => {
    const mapped = Object.values(suggestMapping([...CARGO_EXPORT_HEADERS]))
    expect(mapped.slice().sort()).toEqual([...CARGO_IMPORT_FIELDS].sort())
  })

  it("comes back unchanged when the exported sheet is imported again", () => {
    const lines = [
      line(),
      line({
        sku: "DRM-7",
        name: "Oil drum",
        lengthCm: 58,
        widthCm: 58,
        heightCm: 88.5,
        weightKg: 212.25,
        quantity: 12,
        shape: "CYLINDER_DRUM",
        orientation: "FIXED",
        stackable: true,
        bottomOnly: true,
        maxStackLoadKg: 450,
        maxStackLayers: 2,
        priority: 3,
        destinationStop: 2,
        consignmentId: "CONS-9",
        segregationClass: "3",
        color: "#c4622d",
      }),
    ]
    const headers = [...CARGO_EXPORT_HEADERS]
    const preview = buildImportPreview(
      { headers, rows: cargoExportRows(lines).map((row) => row.map(String)) },
      { lengthUnit: "cm", weightUnit: "kg", columns: suggestMapping(headers) },
    )
    expect(preview.issues).toEqual([])
    expect(preview.drafts).toEqual(lines)
  })

  it("makes a safe file name", () => {
    expect(cargoExportFileName("Flanges - 6 boxes S-1 to S-6")).toBe("Flanges---6-boxes-S-1-to-S-6-cargo.xlsx")
    expect(cargoExportFileName("Jebel Ali / March")).toBe("Jebel-Ali-March-cargo.xlsx")
    expect(cargoExportFileName("  ")).toBe("cargo.xlsx")
  })
})
