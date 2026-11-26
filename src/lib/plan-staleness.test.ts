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
function planFor(lines: StalenessCargo[], extra: Record<string, unknown> = {}) {
  return { createdAt: created, settings: { layoutSource: "AUTO", cargoSignature: cargoSignature(lines), ...extra } }
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

  it("does not change when only the edit time changes", () => {
    expect(cargoSignature([line("a", { updatedAt: new Date() }), cargo[1]!])).toBe(cargoSignature(cargo))
  })

  it("never looked at a retired clearance setting, so signatures saved by earlier versions still match", () => {
    const base = cargoSignature(cargo)
    expect(cargoSignature([line("a", { customFields: { clearanceCm: 9 } }), cargo[1]!])).toBe(base)
    expect(cargoSignature([line("a", { customFields: { clearanceSides: sides } }), cargo[1]!])).toBe(base)
    // The same line with a setting and with rotations: only the rotations count.
    expect(cargoSignature([line("b", { customFields: { allowedRotations: "LWH,WLH", clearanceCm: 4 } }), cargo[0]!])).toBe(cargoSignature([cargo[1]!, cargo[0]!]))
  })

  it("is a fixed fingerprint: a signature stored before clearance was removed is the one computed today", () => {
    // The signature function was not touched by the removal (its body is identical to the checkpoint's), so a value stored in a plan before it stays the value computed now. Changing this value would mark every saved plan out of date.
    expect(cargoSignature(cargo)).toBe("f8c47b9cbe731f24b566c95c005cc4c9000219c9")
  })
})

describe("planStaleness: one verdict for every screen", () => {
  it("is not stale when nothing changed", () => {
    const plan = planFor(cargo)
    expect(planStaleness(plan, cargo)).toBeNull()
    expect(isPlanStale(plan, cargo)).toBe(false)
  })

  it("is stale for cargo when a packing fact changed", () => {
    const plan = planFor(cargo)
    expect(planStaleness(plan, [line("a", { quantity: 9 }), cargo[1]!])).toBe("cargo")
    expect(planStaleness(plan, [cargo[0]!])).toBe("cargo")
    expect(planStaleness(plan, [...cargo, line("c")])).toBe("cargo")
    expect(planStaleness(plan, [line("a", { lengthCm: 101 }), cargo[1]!])).toBe("cargo")
    expect(planStaleness(plan, [line("a", { orientation: "FIXED" }), cargo[1]!])).toBe("cargo")
  })

  it("is not stale merely because the clearance feature was removed", () => {
    // A plan an earlier version saved, with a project default, a configuration and per-line settings recorded.
    const saved = planFor(cargo, { clearanceCm: 8, clearanceConfig: { defaultCm: 8, lines: { a: 3, b: { front: 5, rear: 0, left: 0, right: 0 } } } })
    expect(planStaleness(saved, cargo)).toBeNull()
    // The lines still carry their dormant settings; they are ignored.
    const withSettings = [line("a", { customFields: { clearanceCm: 3 } }), line("b", { customFields: { allowedRotations: "LWH,WLH", clearanceSides: sides } })]
    expect(planStaleness(saved, withSettings)).toBeNull()
    // And a change to a setting alone, in either direction, is not a change to the plan.
    expect(planStaleness(saved, [line("a", { customFields: { clearanceCm: 40 } }), cargo[1]!])).toBeNull()
  })

  it("still notices a real cargo change on a plan that carries old clearance data", () => {
    const saved = planFor(cargo, { clearanceCm: 8, clearanceConfig: { defaultCm: 8, lines: {} } })
    expect(planStaleness(saved, [line("a", { quantity: 9 }), cargo[1]!])).toBe("cargo")
  })

  it("does not care about the layout source, so a hand-arranged plan is judged by its cargo like any other", () => {
    const manual = planFor(cargo, { layoutSource: "MANUAL" })
    expect(planStaleness(manual, cargo)).toBeNull()
    expect(planStaleness(manual, [line("a", { quantity: 9 }), cargo[1]!])).toBe("cargo")
  })

  it("falls back to edit times for plans saved before signatures", () => {
    const old = { createdAt: created, settings: { clearanceCm: 5 } }
    expect(planStaleness(old, cargo)).toBeNull()
    expect(planStaleness(old, [line("a", { updatedAt: new Date("2026-11-11T00:00:00Z") }), cargo[1]!])).toBe("cargo")
    expect(planStaleness({ createdAt: created, settings: null }, cargo)).toBeNull()
    const synced = { createdAt: created, settings: { clearanceCm: 5, syncedAt: "2026-11-12T00:00:00Z" } }
    expect(planStaleness(synced, [line("a", { updatedAt: new Date("2026-11-11T00:00:00Z") }), cargo[1]!])).toBeNull()
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

  it("walks through a successful recalculation: out of date, calculating, ready", () => {
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

  it("an out-of-date plan stays out of date until it is recalculated", () => {
    const plan = planFor(cargo)
    const edited = [line("a", { quantity: 9 }), cargo[1]!]
    const before = derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(plan, cargo), failed: false })
    expect(before.kind).toBe("ready")
    const after = derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(plan, edited), failed: false })
    expect(after.kind).toBe("out-of-date")
    // Recalculating records the new cargo, and the plan is ready again.
    const recalculated = planFor(edited)
    expect(derivePlanStatus({ hasPlan: true, calculating: false, stale: isPlanStale(recalculated, edited), failed: false }).kind).toBe("ready")
  })

  it("the project list uses the same verdict as the project page, not a cargo edit time alone", () => {
    const base = { cargoCount: 2, equipmentCount: 1, lastCargoChange: new Date("2026-11-09T00:00:00Z") }
    const plan = planFor(cargo)
    const edited = [line("a", { quantity: 9 }), cargo[1]!]
    // A change to the cargo makes the plan out of date although no cargo edit time is newer than it.
    expect(projectStatus({ ...base, plan: { createdAt: created, unloadedCount: 0, stale: isPlanStale(plan, edited) } }).kind).toBe("stale")
    expect(projectStatus({ ...base, plan: { createdAt: created, unloadedCount: 0, stale: isPlanStale(plan, cargo) } }).kind).toBe("planned")
    // A cargo edit time newer than the plan does not make it stale when the project's own verdict says it still matches.
    expect(projectStatus({ ...base, lastCargoChange: new Date("2026-11-11T00:00:00Z"), plan: { createdAt: created, unloadedCount: 0, stale: false } }).kind).toBe("planned")
    // Without a verdict the old rule still applies.
    expect(projectStatus({ ...base, lastCargoChange: new Date("2026-11-11T00:00:00Z"), plan: { createdAt: created, unloadedCount: 0 } }).kind).toBe("stale")
  })
})
