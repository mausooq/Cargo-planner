import { describe, expect, it } from "vitest"
import { liveMetrics } from "@/lib/plan-metrics"
import type { PlanItemView } from "@/lib/plan-view"

const unit = { lengthCm: 400, widthCm: 200, heightCm: 200, maxPayloadKg: 1000 }

function box(id: string, x: number, y: number, z: number, kg = 100, size: [number, number, number] = [100, 100, 100]): PlanItemView {
  return {
    id,
    cargoId: id,
    name: id,
    color: "#2563eb",
    x,
    y,
    z,
    lengthCm: size[0],
    widthCm: size[1],
    heightCm: size[2],
    weightKg: kg,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
  }
}

describe("liveMetrics", () => {
  it("adds up weight, volume and floor use", () => {
    const metrics = liveMetrics([box("a", 0, 0, 0), box("b", 100, 0, 0)], unit)
    expect(metrics.netKg).toBe(200)
    expect(metrics.weightPct).toBe(20)
    expect(metrics.volumeM3).toBe(2)
    expect(metrics.volumePct).toBe(12.5) // 2 m³ of 16 m³
    expect(metrics.floorPct).toBe(25) // 2 × 1 m² of 8 m²
  })

  it("counts stacked pieces toward volume but not floor", () => {
    const metrics = liveMetrics([box("a", 0, 0, 0), box("top", 0, 0, 100)], unit)
    expect(metrics.floorPct).toBe(12.5)
    expect(metrics.volumeM3).toBe(2)
  })

  it("finds a balanced centre of gravity for a symmetric load", () => {
    const metrics = liveMetrics([box("l", 150, 0, 0), box("r", 150, 100, 0)], unit)
    expect(metrics.cog?.acrossPct).toBe(50)
    expect(metrics.offCentreCm).toBe(0)
    expect(metrics.warnings).toEqual([])
  })

  it("warns when the weight leans to one side, sits high, or is over the limit", () => {
    expect(liveMetrics([box("l", 0, 0, 0)], unit).warnings[0]).toMatch(/50 cm to the left/)
    expect(liveMetrics([box("high", 0, 50, 100, 100, [100, 100, 100])], unit).warnings).toContain(
      "Weight sits high: put heavier pieces lower",
    )
    expect(liveMetrics([box("heavy", 0, 50, 0, 1200)], unit).warnings[0]).toMatch(/Over the payload limit by 200 kg/)
  })

  it("handles an empty container", () => {
    const metrics = liveMetrics([], unit)
    expect(metrics).toMatchObject({ pieces: 0, netKg: 0, cog: null, warnings: [] })
  })
})
