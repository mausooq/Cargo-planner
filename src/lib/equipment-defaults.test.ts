import { describe, expect, it } from "vitest"
import { equipmentPhysics, OPEN_HEIGHT_CM } from "./equipment-defaults"

describe("equipment physics defaults", () => {
  it("sets the 13.6 m EU box trailer payload and two axle groups", () => {
    const result = equipmentPhysics({
      mode: "ROAD",
      externalId: "11",
      name: "Box Trailer (EU)",
      lengthCm: 1362,
      widthCm: 246,
      heightCm: 270,
    })

    expect(result.maxPayloadKg).toBe(24000)
    expect(result.tareKg).toBe(7000)
    expect(result.heightOpen).toBe(false)
    expect(result.innerHeightCm).toBe(270)
    expect(result.axleGroups).toEqual([
      { name: "Kingpin", positionFromFrontCm: 160, maxKg: 12000 },
      { name: "Rear tandem", positionFromFrontCm: 1180, maxKg: 18000 },
    ])
  })

  it("caps open decks with the documented stack heights", () => {
    const euro = equipmentPhysics({
      mode: "PALLET",
      externalId: "1293",
      name: "Euro pallet",
      lengthCm: 120,
      widthCm: 80,
      heightCm: null,
    })
    expect(euro.heightOpen).toBe(true)
    expect(euro.innerHeightCm).toBe(OPEN_HEIGHT_CM.euroAndGmaPallet)

    const gma = equipmentPhysics({
      mode: "PALLET",
      externalId: "1294",
      name: "GMA Standard Pallet",
      lengthCm: 121.9,
      widthCm: 101.6,
      heightCm: null,
    })
    expect(gma.innerHeightCm).toBe(120)
    expect(gma.maxPayloadKg).toBe(1361)

    const bolster = equipmentPhysics({
      mode: "PALLET",
      externalId: "12123",
      name: "Double-decker bolster for Rolltrailer",
      lengthCm: 606,
      widthCm: 242,
      heightCm: null,
    })
    expect(bolster.innerHeightCm).toBe(OPEN_HEIGHT_CM.palletPlatform)
    expect(bolster.floors).toBe(1)

    const pmc = equipmentPhysics({
      mode: "AIR",
      externalId: "4867",
      name: "PMC/P6P - LD",
      lengthCm: 317,
      widthCm: 244,
      heightCm: null,
    })
    expect(pmc.heightOpen).toBe(true)
    expect(pmc.innerHeightCm).toBe(OPEN_HEIGHT_CM.air)
    expect(pmc.maxPayloadKg).toBe(6804)
    expect(pmc.axleGroups).toEqual([])

    const openRoad = equipmentPhysics({
      mode: "ROAD",
      externalId: "1079",
      name: "Open Trailer (EU)",
      lengthCm: 1395,
      widthCm: 248,
      heightCm: null,
    })
    expect(openRoad.innerHeightCm).toBe(OPEN_HEIGHT_CM.road)
    expect(openRoad.oogClass).toBe("FLATBED")
  })

  it("keeps a rated container height and leaves sea boxes without axles", () => {
    const box = equipmentPhysics({
      mode: "SEA",
      externalId: "1",
      name: "20ft DV",
      lengthCm: 585,
      widthCm: 235,
      heightCm: 239.5,
    })
    expect(box.heightOpen).toBe(false)
    expect(box.innerHeightCm).toBe(239.5)
    expect(box.maxPayloadKg).toBe(21770)
    expect(box.axleGroups).toEqual([])
    expect(box.oogClass).toBe("NONE")
  })

  it("classifies step decks, lowboys, and extendable trailers", () => {
    const step = equipmentPhysics({
      mode: "ROAD",
      externalId: "1075",
      name: "53ft Step Deck Trailer (US)",
      lengthCm: 1615.4,
      widthCm: 259.1,
      heightCm: null,
    })
    expect(step.oogClass).toBe("STEPDECK")

    const lowboy = equipmentPhysics({
      mode: "ROAD",
      externalId: "1078",
      name: "Double Drop Trailer - Low Boy",
      lengthCm: 1463,
      widthCm: 259.1,
      heightCm: null,
    })
    expect(lowboy.oogClass).toBe("LOWBOY")

    const rgn = equipmentPhysics({
      mode: "ROAD",
      externalId: "14269",
      name: "RGN (Extendable)",
      lengthCm: 1463,
      widthCm: 259.1,
      heightCm: null,
    })
    expect(rgn.extendable).toBe(true)
    expect(rgn.maxExtendedLengthCm).toBe(1463 + 610)
    expect(rgn.oogClass).toBe("LOWBOY")
  })

  it("gives rigid vans front and rear axles inside the body", () => {
    const van = equipmentPhysics({
      mode: "ROAD",
      externalId: "5320",
      name: "2ton Van Truck (CN)",
      lengthCm: 420,
      widthCm: 175,
      heightCm: 175,
    })
    expect(van.maxPayloadKg).toBe(2000)
    expect(van.axleGroups.map((group) => group.name)).toEqual(["Front axle", "Rear axle"])
    expect(
      van.axleGroups.every(
        (group) => group.positionFromFrontCm > 0 && group.positionFromFrontCm < 420,
      ),
    ).toBe(true)
  })

  it("models the double-deck trailer as two floors and keeps sheet height", () => {
    const deck = equipmentPhysics({
      mode: "ROAD",
      externalId: "299",
      name: "Double Deck Trailer",
      lengthCm: 1362,
      widthCm: 248,
      heightCm: 400,
    })
    expect(deck.floors).toBe(2)
    expect(deck.heightOpen).toBe(false)
    expect(deck.innerHeightCm).toBe(400)
  })
})
