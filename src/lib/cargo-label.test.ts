import { describe, expect, it } from "vitest"
import { cargoLabelParts, faceCanvasSize, layoutLabel, type MeasureText } from "@/lib/cargo-label"

/** Stand-in for the browser's text measuring: every character is 0.6 of the font size wide, bold 0.65. */
const measure: MeasureText = (text, size, bold) => text.length * size * (bold ? 0.65 : 0.6)

function layout(text: string, maxWidth: number, maxHeight: number, mark: string | null = null) {
  return layoutLabel({ mark, text, maxWidth, maxHeight, maxFontSize: 46, minFontSize: 12, measure })
}

describe("what goes on the label", () => {
  it("puts the mark on its own line above the name", () => {
    expect(cargoLabelParts("S-1", '6-ply box, 6" weld neck flanges')).toEqual({ mark: "S-1", text: '6-ply box, 6" weld neck flanges' })
  })

  it("does not repeat a mark the name already shows", () => {
    expect(cargoLabelParts("S-1", "Flange box S-1")).toEqual({ mark: null, text: "Flange box S-1" })
    expect(cargoLabelParts("rt3", "RT3")).toEqual({ mark: null, text: "rt3" })
  })

  it("copes with a missing mark or name", () => {
    expect(cargoLabelParts(null, " Lipsticks ")).toEqual({ mark: null, text: "Lipsticks" })
    expect(cargoLabelParts("  ", "")).toEqual({ mark: null, text: "Cargo" })
    expect(cargoLabelParts("BOX-9", "")).toEqual({ mark: null, text: "BOX-9" })
  })
})

describe("fitting the label on a face", () => {
  it("uses the largest size for a short label", () => {
    const result = layout("Box", 256, 180)
    expect(result.fontSize).toBe(46)
    expect(result.lines).toEqual([{ text: "Box", bold: false }])
    expect(result.truncated).toBe(false)
  })

  it("wraps and shrinks a long description so every line stays inside the face", () => {
    const text = '6-ply box, 6" weld neck flanges'
    const result = layout(text, 256, 218, "S-1")
    expect(result.truncated).toBe(false)
    expect(result.lines[0]).toEqual({ text: "S-1", bold: true })
    expect(result.lines.slice(1).map((line) => line.text).join(" ")).toBe(text)
    expect(result.lines.length).toBeGreaterThan(2)
    for (const line of result.lines) expect(measure(line.text, result.fontSize, line.bold)).toBeLessThanOrEqual(256)
    expect(result.height).toBeLessThanOrEqual(218)
    expect(result.width).toBeLessThanOrEqual(256)
  })

  it("never splits a word while the label can still fit by shrinking", () => {
    const result = layout("Hydraulic press machine", 120, 200)
    expect(result.lines.map((line) => line.text)).toEqual(["Hydraulic", "press", "machine"])
    expect(result.fontSize).toBeLessThan(46)
  })

  it("cuts a label that cannot fit, and marks the cut with an ellipsis", () => {
    const result = layout("Injection machine 150T screw armour nitrided ID 60 x OD 150 x 1360 MML", 110, 30)
    expect(result.fontSize).toBe(12)
    expect(result.truncated).toBe(true)
    expect(result.lines).toHaveLength(2)
    expect(result.lines.at(-1)!.text.endsWith("…")).toBe(true)
    for (const line of result.lines) expect(measure(line.text, 12, line.bold)).toBeLessThanOrEqual(110)
  })

  it("breaks a single word that is wider than the face at the smallest size", () => {
    const result = layout("Supercalifragilistic", 60, 200)
    expect(result.fontSize).toBe(12)
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.lines.map((line) => line.text).join("")).toBe("Supercalifragilistic")
  })
})

describe("drawing surface for a face", () => {
  it("keeps the face's own shape", () => {
    expect(faceCanvasSize(1)).toEqual({ width: 320, height: 320 })
    expect(faceCanvasSize(2)).toEqual({ width: 320, height: 160 })
    expect(faceCanvasSize(0.5)).toEqual({ width: 160, height: 320 })
  })

  it("keeps a long thin face tall enough for a line of text", () => {
    const size = faceCanvasSize(10)
    expect(size).toEqual({ width: 560, height: 56 })
    expect(size.width / size.height).toBeCloseTo(10, 5)
  })

  it("falls back to a square for a nonsense shape", () => {
    expect(faceCanvasSize(0)).toEqual({ width: 320, height: 320 })
    expect(faceCanvasSize(Number.NaN)).toEqual({ width: 320, height: 320 })
  })
})
