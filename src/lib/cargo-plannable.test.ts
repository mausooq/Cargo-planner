import { cargoPreset } from "@/lib/cargo-defaults"
import { plannableLines } from "@/lib/cargo-validation"
import { describe, expect, it } from "vitest"

const line = (extra: Record<string, unknown> = {}) => ({ ...cargoPreset("BOX"), name: "Crate", lengthCm: 100, widthCm: 80, heightCm: 60, weightKg: 10, quantity: 1, ...extra })

describe("which cargo lines can be packed", () => {
  it("keeps complete lines and leaves out drafts, so an incomplete line never reaches the solver or the equipment suggestions", () => {
    const lines = [line(), line({ weightKg: 0 }), line({ lengthCm: 0 }), line({ name: "" }), line({ name: "Crate 2" })]
    expect(plannableLines(lines).map((entry) => entry.name)).toEqual(["Crate", "Crate 2"])
  })

  it("leaves out a line with an unusable value", () => {
    expect(plannableLines([line({ quantity: 0 }), line({ heightCm: -1 })])).toEqual([])
  })

  it("is empty for no cargo", () => {
    expect(plannableLines([])).toEqual([])
  })
})
