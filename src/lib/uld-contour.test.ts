import { describe, expect, it } from "vitest"
import { uldContour, uldContourVolumeM3 } from "./uld-contour"

describe("ULD contour volume", () => {
  it("uses the Cargo-Planner LD-3 bottom-right cut", () => {
    const contour = uldContour("LD-3 / AKE")
    expect(contour).toEqual({
      bottomLeft: { lengthMm: 0, heightMm: 0 },
      bottomRight: { lengthMm: 450, heightMm: 510 },
      topLeft: { lengthMm: 0, heightMm: 0 },
      topRight: { lengthMm: 0, heightMm: 0 },
    })
    const volume = uldContourVolumeM3(192, 145, 162, contour)
    expect(volume).toBeCloseTo(4.29, 2)
    expect(volume.toFixed(1)).toBe("4.3")
  })

  it("uses the Cargo-Planner A2N house roof", () => {
    const contour = uldContour("A2N")
    expect(contour).toEqual({
      bottomLeft: { lengthMm: 0, heightMm: 0 },
      bottomRight: { lengthMm: 0, heightMm: 0 },
      topLeft: { lengthMm: 1075, heightMm: 910 },
      topRight: { lengthMm: 1075, heightMm: 910 },
    })
    const volume = uldContourVolumeM3(317, 223, 205, contour)
    expect(volume).toBeCloseTo(12.3, 1)
    expect(volume.toFixed(1)).toBe("12.3")
  })
})
