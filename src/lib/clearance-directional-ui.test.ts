import { clearanceViolations } from "@compass/physics"
import { describe, expect, it } from "vitest"
import { rotateItemFlat } from "@/lib/cargo-skin"
import { snapToNeighbours } from "@/lib/cargo-snap"
import { findFreeSpot } from "@/lib/cargo-spot"
import { itemToPiece } from "@/lib/cargo-physics"
import { packingRows } from "@/lib/plan-export"
import { metricBoxesOf } from "@/lib/plan-metrics"
import { liveMetrics } from "@/lib/plan-metrics"
import { clearanceFields, pendingClearanceChanges, toPlanView, withClearanceDraft, withLineClearance, type PlanItemView, type PlanUnitView, type PlanView } from "@/lib/plan-view"
import { buildSolverInput } from "@/lib/solver-input"

const unit = { lengthCm: 500, widthCm: 240, heightCm: 250 } as PlanUnitView
const sides = { front: 20, rear: 0, left: 0, right: 10 }

function item(id: string, x: number, y: number, extra: Partial<PlanItemView> = {}): PlanItemView {
  return {
    id,
    cargoId: id,
    name: id,
    color: "#000",
    x,
    y,
    z: 0,
    lengthCm: 100,
    widthCm: 60,
    heightCm: 100,
    weightKg: 20,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    ...clearanceFields(undefined, 0),
    ...extra,
  }
}

const withSides = (value: typeof sides) => clearanceFields({ clearanceSides: value }, 0)

describe("rotating a piece with directional clearance", () => {
  it("goes through all four facings, swapping its footprint each quarter turn, and comes back", () => {
    let piece = item("a", 0, 0, withSides(sides))
    const seen: string[] = []
    for (let turn = 0; turn < 4; turn += 1) {
      piece = rotateItemFlat(piece)
      seen.push(`${piece.rotation} ${piece.lengthCm}x${piece.widthCm}`)
    }
    expect(seen).toEqual(["WLH 60x100", "LWH@180 100x60", "WLH@180 60x100", "LWH 100x60"])
  })

  it("moves the reserved sides with the piece", () => {
    const start = item("a", 100, 100, withSides(sides))
    const turned = rotateItemFlat(start)
    const boxes = metricBoxesOf([start, turned])
    expect(boxes[0]!.clearance).toEqual({ x0: 20, x1: 0, y0: 0, y1: 10 })
    // A quarter turn clockwise: front now faces the left wall, right faces the front of the unit.
    expect(boxes[1]!.clearance).toEqual({ x0: 10, x1: 0, y0: 20, y1: 0 })
    expect(itemToPiece(turned).clearance).toEqual({ x0: 10, x1: 0, y0: 20, y1: 0 })
  })

  it("keeps the old two-state turn for pieces with the same clearance on every side", () => {
    let piece = item("a", 0, 0, clearanceFields({ clearanceCm: 5 }, 0))
    piece = rotateItemFlat(piece)
    expect(piece.rotation).toBe("WLH")
    piece = rotateItemFlat(piece)
    expect(piece.rotation).toBe("LWH")
  })

  it("does not change the footprint arithmetic or the cargo dimensions", () => {
    const start = item("a", 0, 0, withSides(sides))
    const turned = rotateItemFlat(start)
    expect(turned.lengthCm * turned.widthCm * turned.heightCm).toBe(start.lengthCm * start.widthCm * start.heightCm)
    expect(turned.weightKg).toBe(start.weightKg)
  })
})

describe("snapping and free-spot search honour the side that faces", () => {
  it("snaps against a wall at the allowance of the side that faces it", () => {
    const piece = item("a", 8, 5, withSides(sides))
    const snapped = snapToNeighbours(piece, [], unit)
    expect(snapped.item.x).toBe(20)
    // 5 cm from the left wall is within snapping reach, and the left side needs no clearance.
    expect(snapped.item.y).toBe(0)
    const far = snapToNeighbours(item("b", 395, 5, withSides(sides)), [], unit)
    expect(far.item.x).toBe(400)
  })

  it("snaps to the larger of the two facing allowances next to a neighbour", () => {
    const other = item("o", 0, 100, { ...clearanceFields({ clearanceSides: { front: 0, rear: 30, left: 0, right: 0 } }, 0) })
    const piece = item("m", 135, 100, withSides(sides))
    // The neighbour's rear reserve (30) is larger than the piece's own front reserve (20).
    expect(snapToNeighbours(piece, [other], unit, { x: true, y: false }).item.x).toBe(130)
  })

  it("is flush when nobody has any clearance, as before", () => {
    const other = item("o", 0, 100)
    expect(snapToNeighbours(item("m", 106, 100), [other], unit, { x: true, y: false }).item.x).toBe(100)
  })

  it("finds a free spot that keeps each side's allowance", () => {
    const placed = [item("a", 20, 10, withSides(sides)), item("b", 150, 10, withSides(sides))]
    const spot = findFreeSpot(item("c", 0, 0, withSides(sides)), placed, unit)
    expect(spot).not.toBeNull()
    expect(clearanceViolations(metricBoxesOf([...placed, spot!]), unit)).toEqual([])
  })
})

describe("solver input and plan view carry directional lines", () => {
  const equipment = [{ id: "eq", name: "Box", innerLengthCm: 500, innerWidthCm: 240, innerHeightCm: 250, maxPayloadKg: 1000, tareKg: 0, axleGroups: [], costPerUnit: 1, maxCount: 1, contour: null }]
  const line = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    weightKg: 1,
    quantity: 1,
    shape: "BOX",
    orientation: "ANY",
    allowedRotations: null,
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
    sku: null,
    updatedAt: "",
    ...extra,
  })

  it("passes each line's mode: inherit, uniform (including zero) and directional", () => {
    const input = buildSolverInput({
      cargo: [line("inherit"), line("zero", { clearanceCm: 0 }), line("uniform", { clearanceCm: 4 }), line("dir", { clearanceSides: sides })] as never,
      equipment: equipment as never,
      objective: "FEWEST_UNITS",
      clearanceCm: 6,
    })
    expect(input.settings?.clearanceCm).toBe(6)
    expect(input.cargo.map((entry) => [entry.clearanceCm, entry.clearanceSides])).toEqual([
      [null, null],
      [0, null],
      [4, null],
      [null, sides],
    ])
  })

  it("gives the packer the project's minimum support share, or the shared 75% when it has none", () => {
    const base = { cargo: [line("a")] as never, equipment: equipment as never, objective: "FEWEST_UNITS" as const }
    expect(buildSolverInput(base).settings?.minSupportRatio).toBe(0.75)
    expect(buildSolverInput({ ...base, minSupportPct: null }).settings?.minSupportRatio).toBe(0.75)
    expect(buildSolverInput({ ...base, minSupportPct: 60 }).settings?.minSupportRatio).toBe(0.6)
    // A value outside the allowed range is not a setting: the default applies, nobody gets a weaker share by accident.
    expect(buildSolverInput({ ...base, minSupportPct: 10 }).settings?.minSupportRatio).toBe(0.75)
    expect(buildSolverInput({ ...base, minSupportPct: 500 }).settings?.minSupportRatio).toBe(0.75)
  })

  it("resolves each piece of a calculated plan from its line and the default", () => {
    const result = {
      seed: 1,
      elapsedMs: 1,
      totalCost: 0,
      warnings: [],
      unloaded: [],
      restartsRun: 1,
      settings: { clearanceCm: 3 },
      units: [
        {
          unitIndex: 0,
          equipmentId: "eq",
          metrics: { pieces: 2, netKg: 2, grossKg: 2, volumeM3: 0, volumePct: 0, floorPct: 0, floorActualPct: 0, floorEffectivePct: 0, weightPct: 0, remainingKg: 0, remainingM3: 0, usedLengthCm: 0, usedWidthCm: 0, usedHeightCm: 0, cog: { x: 0, y: 0, z: 0 }, axleLoads: [] },
          placements: [
            { cargoId: "a", instanceIndex: 0, unitIndex: 0, sequence: 1, x: 0, y: 0, z: 0, lengthCm: 10, widthCm: 10, heightCm: 10, rotation: "LWH", layer: 1 },
            { cargoId: "b", instanceIndex: 0, unitIndex: 0, sequence: 2, x: 50, y: 0, z: 0, lengthCm: 10, widthCm: 10, heightCm: 10, rotation: "LWH@180", layer: 1 },
          ],
        },
      ],
    }
    const view = toPlanView(
      result as never,
      [{ id: "eq", name: "Box", mode: "SEA", oogClass: "NONE", heightOpen: false, contour: null, lengthCm: 500, widthCm: 240, heightCm: 250, maxPayloadKg: 1000 }],
      [
        { id: "a", name: "A", weightKg: 1, color: null },
        { id: "b", name: "B", weightKg: 1, color: null, clearanceSides: sides },
      ],
    )
    const [a, b] = view.units[0]!.items
    expect(a).toMatchObject({ clearanceSetting: null, clearance: { front: 3, rear: 3, left: 3, right: 3 } })
    expect(b).toMatchObject({ clearanceSetting: sides, clearance: sides, rotation: "LWH@180" })
  })
})

describe("reports show each line's clearance", () => {
  it("adds a Clearance column to the packing list, in the line's own terms", () => {
    const pieces = [item("a", 0, 0), item("b", 100, 0, withSides(sides)), item("c", 200, 0, clearanceFields({ clearanceCm: 0 }, 5))]
    const plan = {
      clearanceCm: 5,
      units: [{ ...unit, equipmentName: "Box", items: pieces }],
    } as unknown as PlanView
    expect(packingRows(plan).map((row) => row.Clearance)).toEqual([
      "Default · 5 cm",
      "Directional · Front 20 · Rear 0 · Left 0 · Right 10 cm",
      "Custom · 0 cm",
    ])
  })
})

describe("editing a line's clearance in the Playground", () => {
  const saved = [item("a", 10, 10), item("b", 112, 10, { cargoId: "b" }), item("c", 300, 10, { cargoId: "c" })]
  const keepPositions = (items: PlanItemView[]) => items.map((entry) => [entry.id, entry.x, entry.y, entry.z, entry.lengthCm, entry.widthCm, entry.rotation])

  it("changes the setting of every piece of the line and nothing else, leaving the layout where it is", () => {
    const twoOfA = [...saved, item("a-1", 400, 10, { cargoId: "a" })]
    const next = withLineClearance(twoOfA, "a", 6, 0)
    expect(next.filter((entry) => entry.cargoId === "a").every((entry) => entry.clearanceSetting === 6 && entry.clearanceCm === 6)).toBe(true)
    expect(next.filter((entry) => entry.cargoId !== "a")).toEqual(twoOfA.filter((entry) => entry.cargoId !== "a"))
    expect(keepPositions(next)).toEqual(keepPositions(twoOfA))
  })

  it("keeps a valid layout valid and recalculates the numbers live", () => {
    const before = liveMetrics(saved, unit)
    const after = liveMetrics(withLineClearance(saved, "c", 10, 0), unit)
    expect(after.warnings).toEqual(before.warnings)
    expect(after.floorActualPct).toBe(before.floorActualPct)
    expect(after.floorEffectivePct).toBeGreaterThan(before.floorEffectivePct)
  })

  it("flags the pieces that no longer have their room, without moving or dropping any", () => {
    const next = withLineClearance(saved, "a", { front: 0, rear: 40, left: 0, right: 0 }, 0)
    const violations = clearanceViolations(metricBoxesOf(next), unit)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((entry) => entry.id === "a" || entry.otherId === "a")).toBe(true)
    expect(next).toHaveLength(saved.length)
    expect(keepPositions(next)).toEqual(keepPositions(saved))
    expect(liveMetrics(next, unit).warnings.some((line) => /break the handling clearance/.test(line))).toBe(true)
  })

  it("reports what is pending, per line, and nothing once it is undone or reset", () => {
    expect(pendingClearanceChanges(saved, saved)).toEqual([])
    const edited = withLineClearance(withLineClearance(saved, "a", 6, 0), "b", { front: 1, rear: 2, left: 3, right: 4 }, 0)
    expect(pendingClearanceChanges(edited, saved)).toEqual([
      { cargoId: "a", setting: 6 },
      { cargoId: "b", setting: { front: 1, rear: 2, left: 3, right: 4 } },
    ])
    // Undo and Reset put the earlier pieces back: nothing is pending and the numbers are the original ones.
    expect(pendingClearanceChanges(saved, saved)).toEqual([])
    expect(liveMetrics(saved, unit)).toEqual(liveMetrics(saved.map((entry) => ({ ...entry })), unit))
  })

  it("sees an explicit zero or going back to the default as a change from the other", () => {
    const withZero = withLineClearance(saved, "a", 0, 5)
    expect(pendingClearanceChanges(withZero, saved)).toEqual([{ cargoId: "a", setting: 0 }])
    const inherited = withLineClearance(withZero, "a", null, 5)
    expect(inherited.find((entry) => entry.cargoId === "a")?.clearanceCm).toBe(5)
    expect(pendingClearanceChanges(inherited, saved)).toEqual([])
  })

  it("applies the project default again when a line goes back to inheriting", () => {
    const own = withLineClearance(saved, "a", 0, 5)
    expect(own.find((entry) => entry.cargoId === "a")?.clearance).toEqual({ front: 0, rear: 0, left: 0, right: 0 })
    const back = withLineClearance(own, "a", null, 5)
    expect(back.find((entry) => entry.cargoId === "a")?.clearance).toEqual({ front: 5, rear: 5, left: 5, right: 5 })
  })
})

describe("correcting a rejected proposal in the Playground (a temporary draft)", () => {
  const saved = [item("a", 10, 10), item("b", 112, 10, { cargoId: "b" }), item("c", 300, 10, { cargoId: "c" })]
  const keepPositions = (items: PlanItemView[]) => items.map((entry) => [entry.id, entry.x, entry.y, entry.z, entry.lengthCm, entry.widthCm, entry.rotation])
  const proposal = { defaultCm: 8, lines: [{ cargoId: "b", setting: { front: 30, rear: 0, left: 0, right: 0 } as const }] }

  it("applies the proposed default to the lines that inherit it, and the proposed line settings to their lines", () => {
    const next = withClearanceDraft(saved, proposal, 0)
    expect(next.find((entry) => entry.cargoId === "a")).toMatchObject({ clearanceSetting: null, clearanceCm: 8 })
    expect(next.find((entry) => entry.cargoId === "b")).toMatchObject({ clearanceSetting: proposal.lines[0]!.setting, clearanceCm: 30 })
    expect(next.find((entry) => entry.cargoId === "c")).toMatchObject({ clearanceSetting: null, clearanceCm: 8 })
  })

  it("never moves, turns or drops a piece", () => {
    const next = withClearanceDraft(saved, proposal, 0)
    expect(keepPositions(next)).toEqual(keepPositions(saved))
    expect(next).toHaveLength(saved.length)
  })

  it("leaves a line with its own setting alone when only the default is proposed", () => {
    const own = [item("a", 10, 10, clearanceFields({ clearanceCm: 0 }, 0)), item("b", 112, 10, { cargoId: "b" })]
    const next = withClearanceDraft(own, { defaultCm: 9, lines: [] }, 0)
    expect(next[0]).toMatchObject({ clearanceSetting: 0, clearanceCm: 0 })
    expect(next[1]).toMatchObject({ clearanceSetting: null, clearanceCm: 9 })
  })

  it("is the same layout judged under the proposal: the pieces that break it are the ones to fix", () => {
    const next = withClearanceDraft(saved, proposal, 0)
    const violations = clearanceViolations(metricBoxesOf(next), unit)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((entry) => entry.id === "b-0" || entry.otherId === "b-0" || entry.id === "b" || entry.otherId === "b")).toBe(true)
  })

  it("is only pending until saved: the lines it changes are exactly the proposed ones, and discarding returns to the saved layout", () => {
    const next = withClearanceDraft(saved, { lines: proposal.lines }, 0)
    expect(pendingClearanceChanges(next, saved)).toEqual([{ cargoId: "b", setting: proposal.lines[0]!.setting }])
    expect(pendingClearanceChanges(saved, saved)).toEqual([])
    expect(liveMetrics(saved, unit)).toEqual(liveMetrics(saved.map((entry) => ({ ...entry })), unit))
  })

  it("lets the planner correct the layout under the draft and then pass the same check", () => {
    const drafted = withClearanceDraft(saved, proposal, 0)
    expect(clearanceViolations(metricBoxesOf(drafted), unit).length).toBeGreaterThan(0)
    // Move the pieces apart, as the planner would in the Playground.
    const fixed = drafted.map((entry) => (entry.cargoId === "b" ? { ...entry, x: 150 } : entry))
    expect(clearanceViolations(metricBoxesOf(fixed), unit)).toEqual([])
  })
})
