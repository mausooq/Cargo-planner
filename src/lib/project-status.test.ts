import { describe, expect, it } from "vitest"
import { projectStatus, relativeDays } from "@/lib/project-status"

const planAt = new Date("2026-11-10T10:00:00Z")

describe("projectStatus", () => {
  it("walks the steps in order", () => {
    expect(projectStatus({ cargoCount: 0, equipmentCount: 0, plan: null, lastCargoChange: null }).kind).toBe("no-cargo")
    expect(projectStatus({ cargoCount: 2, equipmentCount: 0, plan: null, lastCargoChange: null }).step).toBe("setup")
    expect(projectStatus({ cargoCount: 2, equipmentCount: 1, plan: null, lastCargoChange: null }).kind).toBe("not-calculated")
  })

  it("flags a plan older than the latest cargo edit", () => {
    const status = projectStatus({
      cargoCount: 2,
      equipmentCount: 1,
      plan: { createdAt: planAt, unloadedCount: 0 },
      lastCargoChange: new Date("2026-11-11T00:00:00Z"),
    })
    expect(status).toMatchObject({ kind: "stale", step: "workspace", tone: "warning" })
  })

  it("reports unloaded pieces, then planned", () => {
    const base = { cargoCount: 2, equipmentCount: 1, lastCargoChange: new Date("2026-11-09T00:00:00Z") }
    expect(projectStatus({ ...base, plan: { createdAt: planAt, unloadedCount: 3 } }).label).toBe("3 pieces not loaded")
    expect(projectStatus({ ...base, plan: { createdAt: planAt, unloadedCount: 0 } }).kind).toBe("planned")
  })
})

describe("relativeDays", () => {
  const today = new Date(2026, 10, 18, 15, 30)
  it("describes dates around today", () => {
    expect(relativeDays("2026-11-18", today)).toBe("today")
    expect(relativeDays("2026-11-19", today)).toBe("tomorrow")
    expect(relativeDays("2026-11-25", today)).toBe("in 7 days")
    expect(relativeDays("2026-11-15", today)).toBe("3 days ago")
  })
})
