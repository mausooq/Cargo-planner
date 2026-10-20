import { describe, expect, it } from "vitest"
import { equipmentFormKey } from "@/lib/equipment-form-key"

describe("equipment form key", () => {
  it("resets when the selected equipment changes", () => {
    expect(equipmentFormKey(null)).toBe("new")
    expect(equipmentFormKey(undefined)).toBe("new")
    const first = equipmentFormKey({ id: "unit-a" })
    const second = equipmentFormKey({ id: "unit-b" })
    expect(first).toBe("unit-a")
    expect(second).toBe("unit-b")
    expect(first).not.toBe(second)
  })
})
