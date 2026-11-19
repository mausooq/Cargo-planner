import { describe, expect, it } from "vitest"
import { ETD_IN_PAST_MESSAGE, isPastEtd, isPastEtdOnServer, localIsoDate, projectCreateFormSchema } from "./index"

const now = new Date(2026, 10, 19, 23, 30) // 19 Nov 2026, late evening local time

describe("ETD dates", () => {
  it("formats the local date, not UTC", () => {
    expect(localIsoDate(now)).toBe("2026-11-19")
  })

  it("forms reject dates before today and accept today or later", () => {
    expect(isPastEtd("2026-11-18", now)).toBe(true)
    expect(isPastEtd("2026-11-19", now)).toBe(false)
    expect(isPastEtd("2027-01-05", now)).toBe(false)
  })

  it("the server allows one day of time-zone slack but nothing older", () => {
    expect(isPastEtdOnServer("2026-11-18", now)).toBe(false)
    expect(isPastEtdOnServer("2026-11-17", now)).toBe(true)
  })

  it("ignores values that are not dates", () => {
    expect(isPastEtd("", now)).toBe(false)
  })
})

describe("projectCreateFormSchema", () => {
  const base = { name: "March shipment", mode: "SEA" as const, objective: "FEWEST_UNITS" as const, notes: "" }
  const dayOffset = (days: number) => {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return localIsoDate(date)
  }

  it("rejects yesterday with the ETD message on the ETD field", () => {
    const result = projectCreateFormSchema.safeParse({ ...base, etd: dayOffset(-1) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({ path: ["etd"], message: ETD_IN_PAST_MESSAGE })
  })

  it("accepts today and future dates", () => {
    expect(projectCreateFormSchema.safeParse({ ...base, etd: dayOffset(0) }).success).toBe(true)
    expect(projectCreateFormSchema.safeParse({ ...base, etd: dayOffset(30) }).success).toBe(true)
  })
})
