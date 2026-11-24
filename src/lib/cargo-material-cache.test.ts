import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cargoMaterialCacheSize,
  cargoMaterialKey,
  getCargoMaterials,
  resetCargoMaterialCache,
  retainCargoMaterials,
} from "@/lib/cargo-skin"

const box = { color: "#2563eb", label: "Lipsticks", length: 0.5, width: 0.5, height: 0.5, round: false, simple: false }

afterEach(() => {
  resetCargoMaterialCache()
  vi.useRealTimers()
})

describe("cargo material cache", () => {
  it("gives 100 identical pieces one shared set of materials", () => {
    const sets = Array.from({ length: 100 }, () => getCargoMaterials(box).materials)
    expect(new Set(sets).size).toBe(1)
    expect(cargoMaterialCacheSize()).toBe(1)
  })

  it("keeps different colours, labels, and sizes apart", () => {
    expect(cargoMaterialKey(box)).not.toBe(cargoMaterialKey({ ...box, color: "#f59e0b" }))
    expect(cargoMaterialKey(box)).not.toBe(cargoMaterialKey({ ...box, label: "Perfume" }))
    expect(cargoMaterialKey(box)).not.toBe(cargoMaterialKey({ ...box, height: 1 }))
  })

  it("ignores stray spaces and tiny size noise", () => {
    expect(cargoMaterialKey(box)).toBe(cargoMaterialKey({ ...box, label: " Lipsticks ", length: 0.501 }))
  })

  it("keeps labels apart that print differently: other case, or another mark", () => {
    // The label is printed as typed, so "Lipsticks" and "LIPSTICKS" are different pictures.
    expect(cargoMaterialKey(box)).not.toBe(cargoMaterialKey({ ...box, label: "LIPSTICKS" }))
    expect(cargoMaterialKey({ ...box, mark: "S-1" })).not.toBe(cargoMaterialKey({ ...box, mark: "S-2" }))
    expect(cargoMaterialKey(box)).toBe(cargoMaterialKey({ ...box, mark: null }))
  })

  it("frees an entry only after the last holder lets go", () => {
    vi.useFakeTimers()
    const { key } = getCargoMaterials(box)
    const releaseA = retainCargoMaterials(key)
    const releaseB = retainCargoMaterials(key)
    releaseA()
    vi.advanceTimersByTime(5000)
    expect(cargoMaterialCacheSize()).toBe(1)
    releaseB()
    vi.advanceTimersByTime(5000)
    expect(cargoMaterialCacheSize()).toBe(0)
  })

  it("keeps an entry that is picked up again within the grace period (remounts)", () => {
    vi.useFakeTimers()
    const { key } = getCargoMaterials(box)
    retainCargoMaterials(key)()
    vi.advanceTimersByTime(500)
    const release = retainCargoMaterials(key)
    vi.advanceTimersByTime(5000)
    expect(cargoMaterialCacheSize()).toBe(1)
    release()
  })
})
