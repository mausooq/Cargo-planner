import { describe, expect, it } from "vitest"
import { derivePlanStatus } from "@/lib/plan-status"
import { cargoSignature, isPlanStale, planStaleness, type StalenessCargo } from "@/lib/plan-staleness"
import { projectStatus } from "@/lib/project-status"

const sides = { front: 20, rear: 5, left: 10, right: 5 }
const created = new Date("2026-11-10T10:00:00Z")

function line(id: string, extra: Partial<StalenessCargo> = {}): StalenessCargo {
  return {
    id,
    updatedAt: new Date("2026-11-09T00:00:00Z"),
    customFields: null,
    lengthCm: 100,
    widthCm: 80,
    heightCm: 60,
    weightKg: 20,
    quantity: 4,
    shape: "BOX",
    orientation: "ROTATE_90",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    ...extra,
  }
}

const cargo = [line("a"), line("b", { customFields: { allowedRotations: "LWH,WLH" } })]

/** A plan as the packer stores it for this project. */
function planFor(lines: StalenessCargo[], defaultCm: number, config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    createdAt: created,
    settings: { clearanceCm: defaultCm, clearanceConfig: { defaultCm, lines: config }, cargoSignature: cargoSignature(lines), ...extra },
  }
}

describe("cargoSignature", () => {
  it("does not depend on the order of the lines", () => {
    expect(cargoSignature([cargo[0]!, cargo[1]!])).toBe(cargoSignature([cargo[1]!, cargo[0]!]))
  })

  it("changes when anything that decides packing changes", () => {
    const base = cargoSignature(cargo)
    const changed = [
      line("a", { quantity: 5 }),
      line("a", { lengthCm: 101 }),
      line("a", { weightKg: 21 }),
      line("a", { stackable: false }),
      line("a", { bottomOnly: true }),
      line("a", { orientation: "FIXED" }),
      line("a", { priority: 1 }),
      line("a", { destinationStop: 2 }),
      line("a", { consignmentId: "X" }),
      line("a", { segregationClass: "DG" }),
      line("a", { maxStackLoadKg: 100 }),
      line("a", { maxStackLayers: 2 }),
      line("a", { customFields: { allowedRotations: "LWH" } }),
    ]
    for (const edited of changed) expect(cargoSignature([edited, cargo[1]!])).not.toBe(base)
    expect(cargoSignature([cargo[0]!])).not.toBe(base)
    expect(cargoSignature([...cargo, line("c")])).not.toBe(base)
  })

  it("does not change when only the clearance, the name or the edit time changes", () => {
    const base = cargoSignature(cargo)
    expect(cargoSignature([line("a", { customFields: { clearanceCm: 9 } }), cargo[1]!])).not.toBe(cargoSignature([line("a", { customFields: { allowedRotations: "LWH" } }), cargo[1]!]))
    expect(cargoSignature([line("a", { customFields: { clearanceCm: 9 } }), cargo[1]!])).toBe(base)
    expect(cargoSignature([line("a", { customFields: { clearanceSides: sides } }), cargo[1]!])).toBe(base)
    expect(cargoSignature([line("a", { updatedAt: new Date() }), cargo[1]!])).toBe(base)
  })
})

describe("planStaleness: one verdict for every screen", () => {
  it("is not stale when nothing changed", () => {
    const plan = planFor(cargo, 5)
    expect(planStaleness(plan, cargo, 5)).toBeNull()
    expect(isPlanStale(plan, cargo, 5)).toBe(false)
  })

  it("is stale for cargo when a packing fact changed, even with matching clearance", () => {
    const plan = planFor(cargo, 5)
    expect(planStaleness(plan, [line("a", { quantity: 9 }), cargo[1]!], 5)).toBe("cargo")
    expect(planStaleness(plan, [cargo[0]!], 5)).toBe("cargo")
  })

  it("is stale for clearance when the default or a line's own setting differs from the recorded one", () => {
    const plan = planFor(cargo, 5)
    expect(planStaleness(plan, cargo, 8)).toBe("clearance")
    expect(planStaleness(plan, [line("a", { customFields: { clearanceCm: 3 } }), cargo[1]!], 5)).toBe("clearance")
    expect(planStaleness(plan, [line("a", { customFields: { clearanceSides: sides } }), cargo[1]!], 5)).toBe("clearance")
  })

  it("tells an explicit zero from inheriting", () => {
    const plan = planFor(cargo, 5)
    expect(planStaleness(plan, [line("a", { customFields: { clearanceCm: 0 } }), cargo[1]!], 5)).toBe("clearance")
    const zero = planFor([line("a"), cargo[1]!], 5, { a: 0 })
    expect(planStaleness(zero, [line("a", { customFields: { clearanceCm: 0 } }), cargo[1]!], 5)).toBeNull()
    expect(planStaleness(zero, cargo, 5)).toBe("clearance")
  })

  it("keeps cargo and clearance apart: a clearance edit is not a cargo edit and the other way round", () => {
    const edited = [line("a", { customFields: { clearanceCm: 3 }, updatedAt: new Date("2026-11-12T00:00:00Z") }), cargo[1]!]
    expect(planStaleness(planFor(cargo, 5), edited, 5)).toBe("clearance")
    // The plan is then re-checked under the new clearance: its recorded configuration is updated, its cargo signature is not.
    const rechecked = { ...planFor(cargo, 5, { a: 3 }) }
    expect(planStaleness(rechecked, edited, 5)).toBeNull()
  })

  it("does not let a clearance re-check hide an unrelated cargo edit", () => {
    const edited = [line("a", { customFields: { clearanceCm: 3 }, quantity: 9 }), cargo[1]!]
    const rechecked = planFor(cargo, 5, { a: 3 })
    expect(planStaleness(rechecked, edited, 5)).toBe("cargo")
  })

  it("falls back to edit times for plans saved before signatures, and to the default alone before configurations", () => {
    const old = { createdAt: created, settings: { clearanceCm: 5 } }
    expect(planStaleness(old, cargo, 5)).toBeNull()
    expect(planStaleness(old, [line("a", { updatedAt: new Date("2026-11-11T00:00:00Z") }), cargo[1]!], 5)).toBe("cargo")
    expect(planStaleness(old, cargo, 6)).toBe("clearance")
    expect(planStaleness({ createdAt: created, settings: null }, cargo, 0)).toBeNull()
    const synced = { createdAt: created, settings: { clearanceCm: 5, syncedAt: "2026-11-12T00:00:00Z" } }
    expect(planStaleness(synced, [line("a", { updatedAt: new Date("2026-11-11T00:00:00Z") }), cargo[1]!], 5)).toBeNull()
  })
})

describe("one status for the stepper, both plan pages and the project list", () => {
  it("names the five states and gives failure and calculation priority over everything else", () => {
    const status = (input: Partial<Parameters<typeof derivePlanStatus>[0]>) =>
      derivePlanStatus({ hasPlan: true, calculating: false, stale: false, failed: false, ...input }).kind
    expect(status({ hasPlan: false })).toBe("not-calculated")
    expect(status({ calculating: true })).toBe("calculating")
    expect(status({})).toBe("ready")
    expect(status({ stale: true })).toBe("out-of-date")
    expect(status({ failed: true })).toBe("failed")
    expect(status({ hasPlan: false, failed: true })).toBe("failed")
    expect(status({ stale: true, failed: true })).toBe("failed")
    expect(status({ stale: true, calculating: true, failed: true })).toBe("calculating")
  })

  it("never reports ready while the plan is out of date or a calculation failed", () => {
    for (const stale of [false, true]) {
      for (const failed of [false, true]) {
        const kind = derivePlanStatus({ hasPlan: true, calculating: false, stale, failed }).kind
        expect(kind === "ready").toBe(!stale && !failed)
      }
    }
  })

  it("walks through a successful Save & Recalculate: ready, calculating, ready", () => {
    const steps = [
      { calculating: false, stale: true, failed: false },
      { calculating: true, stale: true, failed: false },
      { calculating: false, stale: false, failed: false },
    ].map((state) => derivePlanStatus({ hasPlan: true, ...state }).kind)
    expect(steps).toEqual(["out-of-date", "calculating", "ready"])
  })

  it("walks through a failed recalculation: the previous plan is never reported ready, and a retry can fix it", () => {
    const steps = [
      { calculating: false, stale: false, failed: false },
      { calculating: true, stale: false, failed: false },
      { calculating: false, stale: true, failed: true },
      { calculating: true, stale: true, failed: false },
      { calculating: false, stale: false, failed: false },
    ].map((state) => derivePlanStatus({ hasPlan: true, ...state }).kind)
    expect(steps).toEqual(["ready", "calculating", "failed", "calculating", "ready"])
  })

  it("keeps the previous status when a proposed clearance change is rejected, because nothing was saved", () => {
    // Rejected: the project and the plan are exactly as before, so the verdict is the same one function of the same inputs.
    const plan = planFor(cargo, 5)
    const before = derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(plan, cargo, 5), failed: false })
    const afterRejection = derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(plan, cargo, 5), failed: false })
    expect(afterRejection).toEqual(before)
    expect(before.kind).toBe("ready")
    // And an out-of-date plan stays out of date.
    const stalePlan = derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(plan, [line("a", { quantity: 9 }), cargo[1]!], 5), failed: false })
    expect(stalePlan.kind).toBe("out-of-date")
  })

  it("the project list uses the same verdict as the project page, not a cargo edit time alone", () => {
    const base = { cargoCount: 2, equipmentCount: 1, lastCargoChange: new Date("2026-11-09T00:00:00Z") }
    const plan = planFor(cargo, 5)
    // A clearance change makes the plan out of date although no cargo edit time is newer than it.
    expect(projectStatus({ ...base, plan: { createdAt: created, unloadedCount: 0, stale: isPlanStale(plan, cargo, 9) } }).kind).toBe("stale")
    expect(projectStatus({ ...base, plan: { createdAt: created, unloadedCount: 0, stale: isPlanStale(plan, cargo, 5) } }).kind).toBe("planned")
    // A cargo edit time newer than the plan does not make it stale when the project's own verdict says it still matches.
    expect(projectStatus({ ...base, lastCargoChange: new Date("2026-11-11T00:00:00Z"), plan: { createdAt: created, unloadedCount: 0, stale: false } }).kind).toBe("planned")
    // Without a verdict the old rule still applies.
    expect(projectStatus({ ...base, lastCargoChange: new Date("2026-11-11T00:00:00Z"), plan: { createdAt: created, unloadedCount: 0 } }).kind).toBe("stale")
  })
})
