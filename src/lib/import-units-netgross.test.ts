import { describe, expect, it } from "vitest"
import { parseWeight, splitNetGross } from "@/lib/import-units"

describe("net and gross weights written in one cell", () => {
  it("splits the shape that blocked the import: 2210 net / 2360 gross", () => {
    expect(splitNetGross("2210 net / 2360 gross")).toEqual({ net: "2210", gross: "2360" })
    // And each part is an ordinary number, not an invalid combined string.
    const parts = splitNetGross("2210 net / 2360 gross")!
    expect(parseWeight(parts.gross, "kg")).toMatchObject({ ok: true, kg: 2360 })
    expect(parseWeight(parts.net, "kg")).toMatchObject({ ok: true, kg: 2210 })
    expect(parseWeight("2210 net / 2360 gross", "kg")).toMatchObject({ ok: false })
  })

  it("reads units, either order and common abbreviations", () => {
    expect(splitNetGross("2210 kg net, 2360 kg gross")).toEqual({ net: "2210 kg", gross: "2360 kg" })
    expect(splitNetGross("NW 2210 kg / GW 2360 kg")).toEqual({ net: "2210 kg", gross: "2360 kg" })
    expect(splitNetGross("N.W. 2210 G.W. 2360 kg")).toEqual({ net: "2210 kg", gross: "2360 kg" })
    expect(splitNetGross("Gross: 2,360 kg  Net: 2,210 kg")).toEqual({ net: "2,210 kg", gross: "2,360 kg" })
    expect(splitNetGross("2210 kg (net) 2360 kg (gross)")).toEqual({ net: "2210 kg", gross: "2360 kg" })
    expect(splitNetGross("netto 2210 kg brutto 2360 kg")).toEqual({ net: "2210 kg", gross: "2360 kg" })
  })

  it("leaves anything that is not clearly one net and one gross alone", () => {
    expect(splitNetGross("2360")).toBeNull()
    expect(splitNetGross("2360 kg gross")).toBeNull()
    expect(splitNetGross("2210 / 2360")).toBeNull()
    expect(splitNetGross("2210 net / 2360 net")).toBeNull()
    expect(splitNetGross("")).toBeNull()
  })
})
