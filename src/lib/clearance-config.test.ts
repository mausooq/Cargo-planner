import { describe, expect, it } from "vitest"
import {
  cargoSetting,
  clearanceConfig,
  clearanceText,
  cleanSetting,
  countSettings,
  describeConfigChange,
  itemSides,
  lineSetting,
  MIN_SUPPORT_PCT,
  ownSidesOfItem,
  parseClearanceConfig,
  projectMinSupportPct,
  sameClearanceConfig,
  settingToCargoFields,
  settingToJson,
} from "@/lib/clearance"
import { clearanceFields } from "@/lib/plan-view"

const sides = { front: 20, rear: 5, left: 10, right: 5 }

describe("a cargo line's stored setting", () => {
  it("reads the three modes from customFields, and a plain old uniform value as before", () => {
    expect(cargoSetting(null)).toBeNull()
    expect(cargoSetting({})).toBeNull()
    expect(cargoSetting({ allowedRotations: "LWH,WLH" })).toBeNull()
    expect(cargoSetting({ clearanceCm: 5 })).toBe(5)
    expect(cargoSetting({ clearanceSides: sides })).toEqual(sides)
  })

  it("keeps an explicit zero apart from inheriting", () => {
    expect(cargoSetting({ clearanceCm: 0 })).toBe(0)
    expect(cargoSetting({})).toBeNull()
    expect(settingToJson(0)).toEqual({ clearanceCm: 0 })
    expect(settingToJson(null)).toEqual({})
  })

  it("lets directional sides win over a leftover uniform number", () => {
    expect(cargoSetting({ clearanceCm: 3, clearanceSides: sides })).toEqual(sides)
  })

  it("ignores invalid, negative and unsupported stored values instead of failing", () => {
    for (const stored of [{ clearanceCm: -1 }, { clearanceCm: "x" }, { clearanceCm: null }, { clearanceSides: { front: 1 } }, { clearanceSides: "x" }, "text", [], 7]) {
      expect(cargoSetting(stored)).toBeNull()
    }
  })

  it("round-trips every mode through its stored form", () => {
    for (const setting of [null, 0, 6.5, sides]) {
      expect(cargoSetting(settingToJson(setting))).toEqual(setting)
    }
  })

  it("turns a setting into the two optional line fields and back", () => {
    expect(settingToCargoFields(null)).toEqual({ clearanceCm: null, clearanceSides: null })
    expect(settingToCargoFields(0)).toEqual({ clearanceCm: 0, clearanceSides: null })
    expect(settingToCargoFields(sides)).toEqual({ clearanceCm: null, clearanceSides: sides })
    for (const setting of [null, 0, 9, sides]) expect(lineSetting(settingToCargoFields(setting))).toEqual(setting)
    expect(lineSetting({ clearanceCm: 4, clearanceSides: sides })).toEqual(sides)
    expect(lineSetting({})).toBeNull()
  })

  it("cleans editor input: rounds, caps and drops what is not a setting", () => {
    expect(cleanSetting(7.25)).toBe(7.3)
    expect(cleanSetting(500)).toBe(100)
    expect(cleanSetting(-3)).toBeNull()
    expect(cleanSetting(undefined)).toBeNull()
    expect(cleanSetting({ front: 1, rear: 2, left: 3, right: 4 })).toEqual({ front: 1, rear: 2, left: 3, right: 4 })
    expect(cleanSetting({ front: -1, rear: 2, left: 3, right: 4 })).toBeNull()
  })

  it("describes a line for reports", () => {
    expect(clearanceText(null, 5)).toBe("Default · 5 cm")
    expect(clearanceText(0, 5)).toBe("Custom · 0 cm")
    expect(clearanceText(sides, 5)).toBe("Directional · Front 20 · Rear 5 · Left 10 · Right 5 cm")
  })

  it("counts lines that inherit and lines with their own setting", () => {
    expect(countSettings([null, null, 0, 4, sides])).toEqual({ inherited: 2, custom: 3 })
    expect(countSettings([])).toEqual({ inherited: 0, custom: 0 })
  })
})

describe("how a piece carries its clearance", () => {
  it("resolves inherit to the project default and keeps an explicit zero", () => {
    expect(clearanceFields({ clearanceCm: null, clearanceSides: null }, 6)).toMatchObject({ clearanceSetting: null, clearance: { front: 6, rear: 6, left: 6, right: 6 }, clearanceCm: 6 })
    expect(clearanceFields({ clearanceCm: 0 }, 6)).toMatchObject({ clearanceSetting: 0, clearanceCm: 0 })
    expect(clearanceFields(undefined, 6).clearanceSetting).toBeNull()
  })

  it("keeps directional sides and reports the largest as the single figure", () => {
    expect(clearanceFields({ clearanceSides: sides }, 6)).toMatchObject({ clearanceSetting: sides, clearance: sides, clearanceCm: 20 })
  })

  it("turns a piece's own sides into placed sides through its rotation", () => {
    const piece = { clearance: sides, clearanceCm: 20 }
    expect(itemSides({ ...piece, rotation: "LWH" })).toEqual({ x0: 20, x1: 5, y0: 10, y1: 5 })
    expect(itemSides({ ...piece, rotation: "WLH" })).toEqual({ x0: 5, x1: 10, y0: 20, y1: 5 })
    expect(itemSides({ ...piece, rotation: "LWH@180" })).toEqual({ x0: 5, x1: 20, y0: 5, y1: 10 })
    expect(itemSides({ ...piece, rotation: "LHW" })).toEqual({ x0: 20, x1: 20, y0: 20, y1: 20 })
  })

  it("falls back to the uniform number for pieces saved before sides existed", () => {
    expect(ownSidesOfItem({ clearanceCm: 5 })).toEqual({ front: 5, rear: 5, left: 5, right: 5 })
    expect(ownSidesOfItem({})).toEqual({ front: 0, rear: 0, left: 0, right: 0 })
    expect(itemSides({ clearanceCm: 5, rotation: "WLH" })).toEqual({ x0: 5, x1: 5, y0: 5, y1: 5 })
    expect(itemSides({ rotation: "LWH" })).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 })
  })
})

describe("the configuration a plan is made under", () => {
  const now = clearanceConfig(5, [
    { id: "a", setting: 8 },
    { id: "b", setting: sides },
    { id: "c", setting: null },
    { id: "d", setting: 0 },
  ])

  it("lists only the lines that have their own setting, including an explicit zero", () => {
    expect(now).toEqual({ defaultCm: 5, lines: { a: 8, b: sides, d: 0 } })
  })

  it("recognises the same configuration and any difference", () => {
    expect(sameClearanceConfig(now, clearanceConfig(5, [{ id: "d", setting: 0 }, { id: "b", setting: sides }, { id: "a", setting: 8 }]))).toBe(true)
    expect(sameClearanceConfig(now, clearanceConfig(6, [{ id: "a", setting: 8 }, { id: "b", setting: sides }, { id: "d", setting: 0 }]))).toBe(false)
    expect(sameClearanceConfig(now, clearanceConfig(5, [{ id: "a", setting: 9 }, { id: "b", setting: sides }, { id: "d", setting: 0 }]))).toBe(false)
    expect(sameClearanceConfig(now, clearanceConfig(5, [{ id: "a", setting: 8 }, { id: "b", setting: { ...sides, rear: 6 } }, { id: "d", setting: 0 }]))).toBe(false)
    expect(sameClearanceConfig(clearanceConfig(5, [{ id: "x", setting: null }]), clearanceConfig(5, []))).toBe(true)
    expect(sameClearanceConfig(clearanceConfig(5, [{ id: "x", setting: 0 }]), clearanceConfig(5, []))).toBe(false)
  })

  it("survives being stored and read back, and rejects junk", () => {
    expect(parseClearanceConfig(JSON.parse(JSON.stringify(now)))).toEqual(now)
    expect(parseClearanceConfig(null)).toBeNull()
    expect(parseClearanceConfig({})).toBeNull()
    expect(parseClearanceConfig({ defaultCm: "x" })).toBeNull()
    expect(parseClearanceConfig({ defaultCm: 4, lines: { a: -1, b: "x", c: 3 } })).toEqual({ defaultCm: 4, lines: { c: 3 } })
  })

  it("says in words what changed since the plan was made", () => {
    expect(describeConfigChange(null, now)).toBeNull()
    expect(describeConfigChange(now, now)).toBeNull()
    const old = clearanceConfig(2, [{ id: "a", setting: 8 }])
    expect(describeConfigChange(old, now)).toBe("project default 2 → 5 cm, 2 cargo lines with a different clearance")
    expect(describeConfigChange(clearanceConfig(5, [{ id: "a", setting: 8 }, { id: "b", setting: sides }]), now)).toBe("1 cargo line with a different clearance")
  })
})

describe("the project's minimum support share", () => {
  it("is read from the project rules when it is a valid percentage, otherwise absent", () => {
    expect(projectMinSupportPct({ minSupportPct: 60 })).toBe(60)
    expect(projectMinSupportPct({ minSupportPct: MIN_SUPPORT_PCT.min })).toBe(50)
    for (const bad of [{}, null, { minSupportPct: 10 }, { minSupportPct: 101 }, { minSupportPct: "70" }, { minSupportPct: Number.NaN }, "x"]) {
      expect(projectMinSupportPct(bad)).toBeNull()
    }
  })
})

describe("the 100 cm limit is the same everywhere", () => {
  it("is the one constant for the packer, the editor, the server actions and the cargo line schema", async () => {
    const { MAX_CLEARANCE_CM } = await import("@/lib/clearance")
    const { cargoItemInputSchema } = await import("@compass/domain")
    const base = {
      sku: null, name: "x", lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null,
      stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null,
    }
    expect(MAX_CLEARANCE_CM).toBe(100)
    expect(cargoItemInputSchema.safeParse({ ...base, clearanceCm: MAX_CLEARANCE_CM }).success).toBe(true)
    expect(cargoItemInputSchema.safeParse({ ...base, clearanceCm: MAX_CLEARANCE_CM + 1 }).success).toBe(false)
    const sides = { front: MAX_CLEARANCE_CM, rear: 0, left: 0, right: 0 }
    expect(cargoItemInputSchema.safeParse({ ...base, clearanceSides: sides }).success).toBe(true)
    expect(cargoItemInputSchema.safeParse({ ...base, clearanceSides: { ...sides, front: MAX_CLEARANCE_CM + 1 } }).success).toBe(false)
    expect(cleanSetting(MAX_CLEARANCE_CM + 50)).toBe(MAX_CLEARANCE_CM)
  })
})
