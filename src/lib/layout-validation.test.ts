import { describe, expect, it } from "vitest"
import { checkLayoutChange, layoutProblems, type LayoutCargoRules, type LayoutPiece } from "@/lib/layout-validation"
import type { PlanItemView } from "@/lib/plan-view"

const unit = { lengthCm: 500, widthCm: 240, heightCm: 250 }

const boxRules: LayoutCargoRules = {
  lengthCm: 100,
  widthCm: 100,
  heightCm: 100,
  orientation: "ROTATE_90",
  shape: "BOX",
  allowedRotations: null,
}

function item(id: string, x: number, y: number, z: number, extra: Partial<PlanItemView> = {}): PlanItemView {
  return {
    id,
    cargoId: id.split("-")[0] ?? id,
    name: id,
    color: "#000",
    x,
    y,
    z,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    weightKg: 50,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    clearanceCm: 0,
    ...extra,
  }
}

const piece = (it: PlanItemView, cargo: LayoutCargoRules = boxRules): LayoutPiece => ({ item: it, cargo })

describe("layoutProblems", () => {
  it("accepts a tidy layout with a stacked piece", () => {
    const layout = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 100, 0, 0)), piece(item("c-0", 0, 0, 100))]
    expect(layoutProblems(unit, layout).size).toBe(0)
  })

  it("accepts pieces at non-grid positions and sizes that are not multiples of 5 cm", () => {
    const odd = item("a-0", 3.3, 1.7, 0, { lengthCm: 117, widthCm: 77, heightCm: 90 })
    const rules = { ...boxRules, lengthCm: 117, widthCm: 77, heightCm: 90 }
    expect(layoutProblems(unit, [piece(odd, rules)]).size).toBe(0)
  })

  it("rejects a piece outside the unit", () => {
    const problems = layoutProblems(unit, [piece(item("a-0", 450, 0, 0))])
    expect(problems.get("a-0")).toMatch(/Outside container/)
  })

  it("rejects a piece that floats with nothing under it", () => {
    const problems = layoutProblems(unit, [piece(item("a-0", 0, 0, 50))])
    expect(problems.get("a-0")).toMatch(/not resting|Not enough support|Unstable/)
  })

  it("rejects a turn the cargo line does not allow", () => {
    const fixed: LayoutCargoRules = { ...boxRules, lengthCm: 120, widthCm: 80, orientation: "FIXED" }
    const turned = item("a-0", 0, 0, 0, { lengthCm: 80, widthCm: 120 })
    expect(layoutProblems(unit, [piece(turned, fixed)]).get("a-0")).toMatch(/does not allow/)
    const asEntered = item("a-0", 0, 0, 0, { lengthCm: 120, widthCm: 80 })
    expect(layoutProblems(unit, [piece(asEntered, fixed)]).size).toBe(0)
  })

  it("accepts a quarter turn when the cargo line allows it", () => {
    const rules: LayoutCargoRules = { ...boxRules, lengthCm: 120, widthCm: 80 }
    const turned = item("a-0", 0, 0, 0, { lengthCm: 80, widthCm: 120, rotation: "WLH" })
    expect(layoutProblems(unit, [piece(turned, rules)]).size).toBe(0)
  })

  it("keeps floor-only and not-stackable rules", () => {
    const floorOnly = item("f-0", 0, 0, 100, { bottomOnly: true })
    const under = item("u-0", 0, 0, 0)
    expect(layoutProblems(unit, [piece(under), piece(floorOnly)]).get("f-0")).toMatch(/floor/)
    const flat = item("n-0", 0, 0, 0, { stackable: false })
    const on = item("o-0", 0, 0, 100)
    expect(layoutProblems(unit, [piece(flat), piece(on)]).get("o-0")).toMatch(/not stackable/)
  })

  it("enforces handling clearance to neighbours and to walls", () => {
    const a = item("a-0", 10, 10, 0, { clearanceCm: 10 })
    const tooClose = item("b-0", 115, 10, 0, { clearanceCm: 10 })
    expect(layoutProblems(unit, [piece(a), piece(tooClose)]).get("b-0")).toMatch(/clearance/i)
    const exact = item("b-0", 120, 10, 0, { clearanceCm: 10 })
    expect(layoutProblems(unit, [piece(a), piece(exact)]).size).toBe(0)
    const atWall = item("w-0", 4, 10, 0, { clearanceCm: 10 })
    expect(layoutProblems(unit, [piece(atWall)]).get("w-0")).toMatch(/past the wall/)
  })

  it("does not ask for clearance between a stacked piece and the one under it", () => {
    const base = item("a-0", 10, 10, 0, { clearanceCm: 10 })
    const top = item("b-0", 10, 10, 100, { clearanceCm: 10 })
    expect(layoutProblems(unit, [piece(base), piece(top)]).size).toBe(0)
  })

  it("does not accept a clearance margin as stacking support", () => {
    const base = item("a-0", 10, 10, 0, { clearanceCm: 10 })
    const overhang = item("b-0", 60, 10, 100, { clearanceCm: 10 })
    expect(layoutProblems(unit, [piece(base), piece(overhang)]).get("b-0")).toBeDefined()
  })
})

describe("checkLayoutChange", () => {
  it("passes a valid edit", () => {
    const before = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 100, 0, 0))]
    const after = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 200, 0, 0))]
    expect(checkLayoutChange(unit, before, after)).toEqual({ ok: true })
  })

  it("rejects an edit that puts a piece in the clearance of another", () => {
    const a = item("a-0", 10, 10, 0, { clearanceCm: 10 })
    const before = [piece(a), piece(item("b-0", 120, 10, 0, { clearanceCm: 10 }))]
    const after = [piece(a), piece(item("b-0", 112, 10, 0, { clearanceCm: 10 }))]
    const result = checkLayoutChange(unit, before, after)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toMatch(/clearance/i)
  })

  it("rejects leaving a piece floating when the one under it is moved away", () => {
    const before = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 0, 0, 100))]
    const after = [piece(item("a-0", 300, 0, 0)), piece(item("b-0", 0, 0, 100))]
    const result = checkLayoutChange(unit, before, after)
    expect(result.ok).toBe(false)
  })

  it("does not block an edit because of a problem that was already there and was not touched", () => {
    const legacyFloating = item("a-0", 0, 0, 50)
    const before = [piece(legacyFloating), piece(item("c-0", 300, 0, 0))]
    const after = [piece(legacyFloating), piece(item("c-0", 350, 0, 0))]
    expect(checkLayoutChange(unit, before, after)).toEqual({ ok: true })
  })

  it("still blocks a piece that was already invalid when it is the one being moved", () => {
    const before = [piece(item("a-0", 0, 0, 50))]
    const after = [piece(item("a-0", 100, 0, 50))]
    expect(checkLayoutChange(unit, before, after).ok).toBe(false)
  })

  it("behaves as before for a plan with no allowance anywhere", () => {
    const before = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 100, 0, 0))]
    const after = [piece(item("a-0", 0, 0, 0)), piece(item("b-0", 100, 0, 0))]
    expect(layoutProblems(unit, after).size).toBe(0)
    expect(checkLayoutChange(unit, before, after)).toEqual({ ok: true })
  })
})
