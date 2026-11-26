import { describe, expect, it } from "vitest"
import { recalculateGuard } from "@/lib/recalc-guard"

describe("asking before a recalculation replaces something the planner arranged", () => {
  it("runs straight away when nothing of the planner's would be lost", () => {
    expect(recalculateGuard({ dirty: false, layoutSource: "AUTO", hasPlan: true })).toBeNull()
    expect(recalculateGuard({ dirty: false, layoutSource: undefined, hasPlan: true })).toBeNull()
    expect(recalculateGuard({ dirty: false, layoutSource: "AUTO", hasPlan: false })).toBeNull()
  })

  it("asks when the saved layout was arranged by hand", () => {
    expect(recalculateGuard({ dirty: false, layoutSource: "MANUAL", hasPlan: true })).toBe("manual")
  })

  it("asks about unsaved moves, which are lost for good, before anything else", () => {
    expect(recalculateGuard({ dirty: true, layoutSource: "AUTO", hasPlan: true })).toBe("unsaved")
    expect(recalculateGuard({ dirty: true, layoutSource: "MANUAL", hasPlan: true })).toBe("unsaved")
  })

  it("does not ask about a hand-arranged layout when there is no plan to replace", () => {
    expect(recalculateGuard({ dirty: false, layoutSource: "MANUAL", hasPlan: false })).toBeNull()
  })
})
