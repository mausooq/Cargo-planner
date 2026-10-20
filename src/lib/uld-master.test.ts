import path from "node:path"
import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { isAirContourName, isAirPalletName } from "./uld-kinds"
import { indexUldByName, normalizeUldName, readUldMaster } from "./uld-master"

describe("ULD master workbook", () => {
  const rows = readUldMaster()
  const byName = indexUldByName(rows)

  it("loads all 48 air types", () => {
    expect(rows).toHaveLength(48)
  })

  it("uses usable LD-3 dimensions in centimetres", () => {
    const ld3 = byName.get(normalizeUldName("LD-3 / AKE"))
    expect(ld3).toMatchObject({
      innerLengthCm: 192,
      innerWidthCm: 145,
      innerHeightCm: 162,
      maxPayloadKg: 1516,
      heightOpen: false,
    })
    expect(isAirContourName("LD-3 / AKE")).toBe(true)
  })

  it("uses published PMC pallet payload and usable height", () => {
    const pmc = byName.get(normalizeUldName("PMC/P6P - LD"))
    expect(pmc).toMatchObject({
      innerLengthCm: 307,
      innerWidthCm: 233,
      innerHeightCm: 152,
      maxPayloadKg: 5000,
      tareKg: 120,
      heightOpen: true,
    })
    expect(isAirPalletName("PMC/P6P - LD")).toBe(true)
    expect(isAirContourName("LD-11 / ALP")).toBe(false)
  })

  it("matches every Air-sheet name after whitespace normalize", () => {
    const workbook = XLSX.readFile(path.join(process.cwd(), "Equipment_List_and_Dimensions.xlsx"))
    const air = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Air, { header: 1, raw: true })
    const missing: string[] = []
    for (let index = 1; index < air.length; index += 1) {
      const name = String(air[index]?.[1] ?? "").trim()
      if (!name) continue
      if (!byName.has(normalizeUldName(name))) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it("uses the Cargo-Planner A2N inner envelope", () => {
    const a2n = byName.get(normalizeUldName("A2N"))
    expect(a2n).toMatchObject({
      innerLengthCm: 317,
      innerWidthCm: 223,
      innerHeightCm: 205,
      maxPayloadKg: 6033,
      tareKg: 480,
      heightOpen: false,
    })
    expect(isAirContourName("A2N")).toBe(true)
  })

  it("keeps CMP on internal dimensions when external is missing", () => {
    const cmp = byName.get(normalizeUldName("CMP"))
    expect(cmp).toMatchObject({
      innerLengthCm: 221,
      innerWidthCm: 152,
      innerHeightCm: 204,
      maxPayloadKg: 4000,
    })
  })
})
