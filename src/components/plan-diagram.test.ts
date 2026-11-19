import { describe, expect, it } from "vitest"
import { numberRange } from "@/components/plan-diagram"

describe("numberRange", () => {
  it("collapses runs and keeps gaps", () => {
    expect(numberRange([3, 1, 2, 7])).toBe("1–3, 7")
    expect(numberRange([5])).toBe("5")
    expect(numberRange([2, 2, 4, 5])).toBe("2, 4–5")
    expect(numberRange([])).toBe("")
  })
})
