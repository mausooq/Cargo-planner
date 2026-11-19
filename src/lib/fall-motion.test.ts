import { describe, expect, it } from "vitest"
import { fallDurationMs, fallHeight } from "@/lib/fall-motion"

describe("fallDurationMs", () => {
  it("takes longer for taller drops, within limits", () => {
    const short = fallDurationMs(10)
    const medium = fallDurationMs(60)
    const tall = fallDurationMs(200)
    expect(short).toBeLessThan(medium)
    expect(medium).toBeLessThan(tall)
    expect(short).toBeGreaterThanOrEqual(220)
    expect(fallDurationMs(5000)).toBeLessThanOrEqual(Math.round(650 / 0.78))
  })

  it("is zero when nothing falls", () => {
    expect(fallDurationMs(0)).toBe(0)
  })
})

describe("fallHeight", () => {
  it("starts at the top and ends exactly on the landing height", () => {
    expect(fallHeight(60, 0, 0)).toBe(60)
    expect(fallHeight(60, 0, 1)).toBe(0)
  })

  it("accelerates: covers less ground early than late", () => {
    const firstQuarter = 60 - fallHeight(60, 0, 0.2)
    const secondQuarter = fallHeight(60, 0, 0.2) - fallHeight(60, 0, 0.4)
    expect(firstQuarter).toBeLessThan(secondQuarter)
  })

  it("never sinks below the landing height and bounces only a little", () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const z = fallHeight(100, 20, t)
      expect(z).toBeGreaterThanOrEqual(20)
      expect(z).toBeLessThanOrEqual(100)
    }
    const bounce = Math.max(...Array.from({ length: 21 }, (_, i) => fallHeight(100, 20, 0.8 + i * 0.01))) - 20
    expect(bounce).toBeGreaterThan(0)
    expect(bounce).toBeLessThanOrEqual(4)
  })
})
