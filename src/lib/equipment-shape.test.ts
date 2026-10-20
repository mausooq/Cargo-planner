import { describe, expect, it } from "vitest"
import { visualKind } from "./equipment-shape"

describe("equipment visual kind", () => {
  it("uses a flat deck with wheels for road flatbeds", () => {
    expect(
      visualKind({
        mode: "ROAD",
        name: "48ft Flatbed Trailer (US)",
        heightOpen: true,
        oogClass: "FLATBED",
      }),
    ).toBe("FLATBED")
  })

  it("uses a closed box for dry containers and ULDs", () => {
    expect(visualKind({ mode: "SEA", name: "40ft HC", heightOpen: false, oogClass: "NONE" })).toBe("CLOSED_BOX")
    expect(visualKind({ mode: "AIR", name: "LD-9 / AAP", heightOpen: false, oogClass: "NONE" })).toBe("CLOSED_BOX")
    expect(visualKind({ mode: "AIR", name: "LD-11 / ALP", heightOpen: false, oogClass: "NONE" })).toBe("CLOSED_BOX")
    expect(visualKind({ mode: "AIR", name: "LD-26 / AAF", heightOpen: false, oogClass: "NONE" })).toBe("AIR_CONTOUR")
    expect(visualKind({ mode: "AIR", name: "A2N", heightOpen: false, oogClass: "NONE" })).toBe("AIR_CONTOUR")
    expect(visualKind({ mode: "AIR", name: "PMC/P6P - LD", heightOpen: true, oogClass: "NONE" })).toBe("AIR_PALLET")
    expect(visualKind({ mode: "AIR", name: "PAG/P1P - LD-7", heightOpen: true, oogClass: "NONE" })).toBe("AIR_PALLET")
  })

  it("uses pallet and bolster shapes on the pallet sheet", () => {
    expect(visualKind({ mode: "PALLET", name: "Euro pallet", heightOpen: true, oogClass: "NONE" })).toBe("PALLET")
    expect(
      visualKind({
        mode: "PALLET",
        name: "Double-decker bolster for Rolltrailer",
        heightOpen: true,
        oogClass: "NONE",
      }),
    ).toBe("BOLSTER")
  })
})
