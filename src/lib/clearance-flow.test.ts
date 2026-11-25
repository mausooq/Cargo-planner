import { describe, expect, it, vi } from "vitest"
import type { ClearanceInput } from "@/app/actions/clearance"
import type { ClearanceConfig } from "@/lib/clearance"
import { createFlowLock, describeProposedChange, retryRecalculation, runClearanceFlow, type FlowDeps } from "@/lib/clearance-flow"

const saved: ClearanceConfig = { defaultCm: 8, lines: { a: 12, b: { front: 20, rear: 5, left: 10, right: 5 } } }
const change: ClearanceInput = {
  defaultCm: 8,
  lines: [
    { cargoId: "a", setting: 12 },
    { cargoId: "b", setting: { front: 20, rear: 5, left: 10, right: 5 } },
    { cargoId: "c", setting: null },
  ],
}

function deps(overrides: Partial<FlowDeps> = {}) {
  const calls: string[] = []
  const statuses: (string | null)[] = []
  const value: FlowDeps = {
    hasPlan: true,
    manualLayout: false,
    save: vi.fn(async () => {
      calls.push("save")
      return { ok: true as const, config: saved }
    }),
    recalculate: vi.fn(async () => {
      calls.push("recalculate")
      return { ok: true as const }
    }),
    keep: vi.fn(async () => {
      calls.push("keep")
      return { ok: true as const }
    }),
    setStatus: (text) => statuses.push(text),
    ...overrides,
  }
  return { value, calls, statuses }
}

describe("Save & Recalculate", () => {
  it("saves and recalculates once when a plan exists, in that order", async () => {
    const { value, calls } = deps()
    const outcome = await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })
    expect(outcome).toEqual({ kind: "recalculated" })
    expect(calls).toEqual(["save", "recalculate"])
  })

  it("recalculates with the configuration the server stored, not with the request", async () => {
    const { value } = deps()
    await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })
    expect(value.recalculate).toHaveBeenCalledTimes(1)
    expect(value.recalculate).toHaveBeenCalledWith(saved)
  })

  it("applies many line changes with a single solver run", async () => {
    const many: ClearanceInput = { defaultCm: 3, lines: Array.from({ length: 200 }, (_, index) => ({ cargoId: `line-${index}`, setting: index % 3 === 0 ? null : index })) }
    const { value } = deps()
    await runClearanceFlow(value, many, "recalculate", createFlowLock(), { confirmed: true })
    expect(value.save).toHaveBeenCalledTimes(1)
    expect(value.recalculate).toHaveBeenCalledTimes(1)
  })

  it("only saves when there is no plan yet, and never runs the packer", async () => {
    const { value, calls } = deps({ hasPlan: false })
    expect(await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })).toEqual({ kind: "saved" })
    expect(calls).toEqual(["save"])
    expect(value.recalculate).not.toHaveBeenCalled()
  })

  it("stops after a failed save without recalculating", async () => {
    const { value } = deps({ save: vi.fn(async () => ({ ok: false as const, error: "Enter clearances from 0 to 100 cm." })) })
    expect(await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })).toEqual({ kind: "save-failed", error: "Enter clearances from 0 to 100 cm." })
    expect(value.recalculate).not.toHaveBeenCalled()
  })

  it("shows what it is doing and clears it afterwards, even when it fails", async () => {
    const ok = deps()
    await runClearanceFlow(ok.value, change, "recalculate", createFlowLock(), { confirmed: true })
    expect(ok.statuses).toEqual(["Saving clearance settings…", "Recalculating the load plan…", null])
    const failing = deps({ recalculate: vi.fn(async () => ({ ok: false as const, message: "The solver timed out." })) })
    await runClearanceFlow(failing.value, change, "recalculate", createFlowLock(), { confirmed: true })
    expect(failing.statuses.at(-1)).toBeNull()
  })
})

describe("duplicate submissions", () => {
  it("refuses a second request while one is running and runs the packer only once", async () => {
    let release: () => void = () => undefined
    const slow = deps({
      recalculate: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            release = () => resolve({ ok: true })
          }),
      ),
    })
    const lock = createFlowLock()
    const first = runClearanceFlow(slow.value, change, "recalculate", lock, { confirmed: true })
    await Promise.resolve()
    const second = await runClearanceFlow(slow.value, change, "recalculate", lock, { confirmed: true })
    const retry = await retryRecalculation(slow.value, saved, lock)
    expect(second).toEqual({ kind: "busy" })
    expect(retry).toEqual({ kind: "busy" })
    release()
    await first
    expect(slow.value.save).toHaveBeenCalledTimes(1)
    expect(slow.value.recalculate).toHaveBeenCalledTimes(1)
  })

  it("accepts a new request once the previous one has finished", async () => {
    const { value } = deps()
    const lock = createFlowLock()
    await runClearanceFlow(value, change, "recalculate", lock, { confirmed: true })
    expect(await runClearanceFlow(value, change, "recalculate", lock, { confirmed: true })).toEqual({ kind: "recalculated" })
    expect(value.save).toHaveBeenCalledTimes(2)
  })

  it("releases the lock when something throws", async () => {
    const { value } = deps({
      save: vi.fn(async () => {
        throw new Error("network down")
      }),
    })
    const lock = createFlowLock()
    await expect(runClearanceFlow(value, change, "recalculate", lock, { confirmed: true })).rejects.toThrow("network down")
    expect(lock.running).toBe(false)
  })
})

describe("recalculation failure and retry", () => {
  it("reports the failure with the saved configuration, so the previous plan can stay and a retry can reuse it", async () => {
    const { value } = deps({ recalculate: vi.fn(async () => ({ ok: false as const, message: "The solver timed out." })) })
    expect(await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })).toEqual({
      kind: "recalc-failed",
      message: "The solver timed out.",
      config: saved,
    })
    expect(value.save).toHaveBeenCalledTimes(1)
  })

  it("retries without saving again, using the same saved configuration", async () => {
    const retryDeps = deps()
    expect(await retryRecalculation(retryDeps.value, saved, createFlowLock())).toEqual({ kind: "recalculated" })
    expect(retryDeps.value.save).not.toHaveBeenCalled()
    expect(retryDeps.value.recalculate).toHaveBeenCalledWith(saved)
  })

  it("can fail again on retry and still hand back the same configuration", async () => {
    const failing = deps({ recalculate: vi.fn(async () => ({ ok: false as const, message: "Still failing." })) })
    expect(await retryRecalculation(failing.value, saved, createFlowLock())).toEqual({ kind: "recalc-failed", message: "Still failing.", config: saved })
  })
})

describe("choosing between keeping the layout and recalculating", () => {
  it("asks first for ANY calculated plan, automatic or hand-arranged, and does nothing until answered", async () => {
    for (const manualLayout of [false, true]) {
      const { value, calls } = deps({ manualLayout })
      expect(await runClearanceFlow(value, change, "recalculate", createFlowLock())).toEqual({ kind: "needs-confirmation", manual: manualLayout })
      expect(calls).toEqual([])
    }
  })

  it("recalculates once the planner has confirmed, for an automatic and for a manual plan", async () => {
    for (const manualLayout of [false, true]) {
      const { value, calls } = deps({ manualLayout })
      expect(await runClearanceFlow(value, change, "recalculate", createFlowLock(), { confirmed: true })).toEqual({ kind: "recalculated" })
      expect(calls).toEqual(["save", "recalculate"])
    }
  })

  it("keeps the current layout when it still works, for an automatic plan as well: no packer run, nothing saved separately", async () => {
    for (const manualLayout of [false, true]) {
      const { value, calls } = deps({ manualLayout })
      expect(await runClearanceFlow(value, change, "keep", createFlowLock())).toEqual({ kind: "kept" })
      expect(calls).toEqual(["keep"])
      expect(value.recalculate).not.toHaveBeenCalled()
      expect(value.save).not.toHaveBeenCalled()
    }
  })

  it("keeps nothing and says which pieces break the proposal when the layout cannot satisfy it", async () => {
    const violations = [{ unitIndex: 1, id: "c1-0", message: "Crate: Needs 5 cm more clearance from Box." }]
    const { value } = deps({ keep: vi.fn(async () => ({ ok: false as const, problems: [violations[0]!.message], violations })) })
    expect(await runClearanceFlow(value, change, "keep", createFlowLock())).toEqual({
      kind: "rejected",
      problems: [violations[0]!.message],
      violations,
      change,
    })
    expect(value.save).not.toHaveBeenCalled()
    expect(value.recalculate).not.toHaveBeenCalled()
  })

  it("hands back the rejected proposal unchanged so it can be kept as a draft", async () => {
    const { value } = deps({ keep: vi.fn(async () => ({ ok: false as const, problems: ["x"], violations: [] })) })
    const outcome = await runClearanceFlow(value, change, "keep", createFlowLock())
    expect(outcome.kind === "rejected" && outcome.change).toBe(change)
  })

  it("does not ask when there is no plan to protect: it just saves", async () => {
    for (const manualLayout of [false, true]) {
      const { value, calls } = deps({ manualLayout, hasPlan: false })
      expect(await runClearanceFlow(value, change, "recalculate", createFlowLock())).toEqual({ kind: "saved" })
      expect(calls).toEqual(["save"])
    }
  })

  it("lets a keep run again after a rejection without needing to save anything first", async () => {
    let allow = false
    const { value } = deps({
      keep: vi.fn(async () => (allow ? { ok: true as const } : { ok: false as const, problems: ["x"], violations: [] })),
    })
    const lock = createFlowLock()
    expect((await runClearanceFlow(value, change, "keep", lock)).kind).toBe("rejected")
    allow = true
    expect((await runClearanceFlow(value, change, "keep", lock)).kind).toBe("kept")
    expect(value.save).not.toHaveBeenCalled()
  })
})

describe("describing a proposed change", () => {
  const lines = [
    { id: "a", name: "Crate" },
    { id: "b", name: "" },
  ]

  it("lists the default and each line in words", () => {
    expect(
      describeProposedChange(
        { defaultCm: 5, lines: [{ cargoId: "a", setting: 0 }, { cargoId: "b", setting: { front: 20, rear: 5, left: 10, right: 5 } }, { cargoId: "z", setting: null }] },
        lines,
        20,
      ),
    ).toEqual([
      "Project default: 20 cm → 5 cm",
      "Crate: 0 cm on every side",
      "Unnamed line: front 20, rear 5, left 10, right 5 cm",
      "A cargo line: project default",
    ])
  })

  it("leaves out a default that did not change", () => {
    expect(describeProposedChange({ defaultCm: 5, lines: [] }, lines, 5)).toEqual([])
    expect(describeProposedChange({ lines: [{ cargoId: "a", setting: 7 }] }, lines, 5)).toEqual(["Crate: 7 cm on every side"])
  })
})
