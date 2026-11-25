import { describe, expect, it } from "vitest"
import { parseWeight, readNumber, readSize, splitCombinedSize } from "@/lib/import-units"

describe("numbers written in different countries", () => {
  it("reads plain, grouped and decimal-comma numbers", () => {
    expect(readNumber("150")).toEqual({ value: 150, ambiguous: false })
    expect(readNumber("1,200.5")).toEqual({ value: 1200.5, ambiguous: false })
    expect(readNumber("1.200,5")).toEqual({ value: 1200.5, ambiguous: false })
    expect(readNumber("1 200,5")).toEqual({ value: 1200.5, ambiguous: false })
    expect(readNumber("5,5")).toEqual({ value: 5.5, ambiguous: false })
    expect(readNumber("0.75")).toEqual({ value: 0.75, ambiguous: false })
    expect(readNumber("1.200.300")).toEqual({ value: 1200300, ambiguous: false })
  })

  it("flags a single separator before exactly three digits as ambiguous, read the English way", () => {
    expect(readNumber("1,200")).toEqual({ value: 1200, ambiguous: true })
    expect(readNumber("12,500")).toEqual({ value: 12500, ambiguous: true })
    // The dot is the decimal point unless told otherwise, as everywhere in Compass; it is still flagged.
    expect(readNumber("1.200")).toEqual({ value: 1.2, ambiguous: true })
    expect(readNumber("3.048")).toEqual({ value: 3.048, ambiguous: true })
    // A leading zero can only be a decimal.
    expect(readNumber("0.777")).toEqual({ value: 0.777, ambiguous: false })
    expect(readNumber("0,777")).toEqual({ value: 0.777, ambiguous: false })
  })

  it("refuses text that is not a number", () => {
    expect(readNumber("abc")).toBeNull()
    expect(readNumber("")).toBeNull()
    expect(readNumber("12 kg")).toBeNull()
  })
})

describe("weights in the document's unit, kept in kilograms", () => {
  it("converts kg, g, tonnes and pounds", () => {
    expect(parseWeight("150", "kg")).toMatchObject({ ok: true, kg: 150, explicit: false })
    expect(parseWeight("150 kg", null)).toMatchObject({ ok: true, kg: 150, explicit: true })
    expect(parseWeight("2500 g", "kg")).toMatchObject({ ok: true, kg: 2.5, unit: "g" })
    expect(parseWeight("1.2 t", "kg")).toMatchObject({ ok: true, kg: 1200 })
    expect(parseWeight("330 lbs", "kg")).toMatchObject({ ok: true, kg: 149.6855 })
    expect(parseWeight("100 lb", null)).toMatchObject({ ok: true, kg: 45.3592 })
  })

  it("does not guess a unit, and refuses the ambiguous word ton", () => {
    expect(parseWeight("150", null)).toMatchObject({ ok: false })
    expect(parseWeight("2 tons", "kg")).toMatchObject({ ok: false, reason: expect.stringContaining("short, long or metric") })
    expect(parseWeight("12 stone", "kg")).toMatchObject({ ok: false })
    expect(parseWeight("-5 kg", "kg")).toMatchObject({ ok: false })
  })

  it("passes an ambiguous number format through so it can be flagged", () => {
    expect(parseWeight("1,200 kg", null)).toMatchObject({ ok: true, kg: 1200, ambiguousNumber: true })
  })
})

describe("combined sizes", () => {
  it("splits sizes with a unit written once", () => {
    expect(splitCombinedSize("120 x 80 x 60 cm")).toEqual({ parts: ["120", "80", "60 cm"], unit: "cm" })
    expect(splitCombinedSize("1.2 x 0.8 x 0.6 m")).toEqual({ parts: ["1.2", "0.8", "0.6 m"], unit: "m" })
    expect(splitCombinedSize("48 x 32 x 24 inches")).toEqual({ parts: ["48", "32", "24 inches"], unit: "in" })
    expect(splitCombinedSize("120×80×60 CM")?.unit).toBe("cm")
    expect(splitCombinedSize("120*80*60mm")?.unit).toBe("mm")
    expect(splitCombinedSize("120 by 80 by 60")?.unit).toBeNull()
  })

  it("keeps feet and inches whole and does not mistake 5.6 ft for 5 ft 6 in", () => {
    const mixed = splitCombinedSize("5 ft 6 in x 3 ft x 2 ft")
    expect(mixed?.parts).toEqual(["5 ft 6 in", "3 ft", "2 ft"])
    expect(readSize("5 ft 6 in", null)).toMatchObject({ ok: true, cm: 167.64 })
    expect(readSize("5.6", "ft")).toMatchObject({ ok: true, cm: 170.688 })
    expect(readSize("5'6\"", null)).toMatchObject({ ok: true, cm: 167.64 })
  })

  it("reports no size when it is not three parts", () => {
    expect(splitCombinedSize("120 x 80")).toBeNull()
    expect(splitCombinedSize("")).toBeNull()
    expect(splitCombinedSize("wooden box")).toBeNull()
  })

  it("asks for a unit instead of assuming one", () => {
    expect(readSize("120", null)).toEqual({ ok: true, cm: null, needsUnit: true })
    expect(readSize("120", "cm")).toEqual({ ok: true, cm: 120, needsUnit: false })
    expect(readSize("1200 mm", null)).toMatchObject({ ok: true, cm: 120 })
    expect(readSize("1,200", "mm")).toMatchObject({ ok: true, cm: 120 })
    expect(readSize("", "cm")).toMatchObject({ ok: false })
    expect(readSize("tall", "cm")).toMatchObject({ ok: false })
  })
})
