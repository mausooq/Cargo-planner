import { describe, expect, it } from "vitest"
import {
  cargoClearance,
  formatClearance,
  MAX_CLEARANCE_CM,
  normaliseClearance,
  normaliseOverride,
  projectClearance,
} from "@/lib/clearance"

describe("allowance helpers", () => {
  it("defaults to no allowance for anything missing or invalid", () => {
    for (const value of [undefined, null, "", "x", -1, 0, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      expect(normaliseClearance(value)).toBe(0)
    }
    expect(projectClearance(undefined)).toBe(0)
    expect(projectClearance({})).toBe(0)
    expect(projectClearance("text")).toBe(0)
    expect(projectClearance([])).toBe(0)
  })

  it("accepts numbers and numeric text, rounds to 0.1 and caps the value", () => {
    expect(normaliseClearance(5)).toBe(5)
    expect(normaliseClearance("7.25")).toBe(7.3)
    expect(normaliseClearance(MAX_CLEARANCE_CM + 50)).toBe(MAX_CLEARANCE_CM)
    expect(projectClearance({ clearanceCm: 12 })).toBe(12)
  })

  it("keeps 'no override' apart from an explicit zero on a cargo line", () => {
    expect(normaliseOverride(null)).toBeNull()
    expect(normaliseOverride(undefined)).toBeNull()
    expect(normaliseOverride("")).toBeNull()
    expect(normaliseOverride(-3)).toBeNull()
    expect(normaliseOverride(0)).toBe(0)
    expect(cargoClearance({ clearanceCm: 0 })).toBe(0)
    expect(cargoClearance({ clearanceCm: 4 })).toBe(4)
    expect(cargoClearance({ allowedRotations: "LWH" })).toBeNull()
    expect(cargoClearance(null)).toBeNull()
  })

  it("describes the allowance in words", () => {
    expect(formatClearance(0)).toBe("none")
    expect(formatClearance(5)).toBe("5 cm per side")
  })
})
