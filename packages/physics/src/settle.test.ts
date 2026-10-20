import { describe, expect, it } from "vitest"
import { hasInterpenetration, settleBodies } from "./settle"
import { DEFAULT_WORLD, boxBody, cylinderBody } from "./types"

const room = { ...DEFAULT_WORLD, lengthCm: 400, widthCm: 400, heightCm: 400 }

describe("gravity settle", () => {
  it("drops a single box onto the floor (bottom = 0)", () => {
    const floating = boxBody("a", 10, 10, 120, 100, 80, 60, 400)
    const { bodies } = settleBodies([floating], room)
    const settled = bodies[0]
    expect(settled).toBeTruthy()
    expect(settled!.cz - settled!.hz).toBeCloseTo(0, 6)
    expect(settled!.cx).toBeCloseTo(60, 6)
  })

  it("stacks a second box on the first with exact contact at z = 60", () => {
    const base = boxBody("base", 0, 0, 0, 100, 100, 60, 400)
    const top = boxBody("top", 10, 10, 200, 80, 80, 40, 400)
    const { bodies } = settleBodies([top, base], room)
    const stacked = bodies.find((body) => body.id === "top")
    expect(stacked).toBeTruthy()
    expect(stacked!.cz - stacked!.hz).toBeCloseTo(60, 6)
    expect(hasInterpenetration(bodies)).toBe(false)
  })

  it("a box released over empty floor falls past a distant neighbour", () => {
    const neighbour = boxBody("side", 200, 0, 0, 80, 80, 80, 400)
    const falling = boxBody("drop", 0, 0, 180, 80, 80, 80, 400)
    const { bodies } = settleBodies([neighbour, falling], room)
    const drop = bodies.find((body) => body.id === "drop")
    expect(drop!.cz - drop!.hz).toBeCloseTo(0, 6)
  })

  it("settles a cylinder onto a box when footprints overlap", () => {
    const crate = boxBody("crate", 0, 0, 0, 120, 120, 80, 400)
    const pipe = cylinderBody("pipe", 10, 10, 300, 100, 100, 150, 122)
    const { bodies } = settleBodies([crate, pipe], room)
    const settled = bodies.find((body) => body.id === "pipe")
    expect(settled!.cz - settled!.hz).toBeCloseTo(80, 6)
    expect(hasInterpenetration(bodies)).toBe(false)
  })

  it("never leaves interpenetration after a three-high stack settle", () => {
    const a = boxBody("a", 0, 0, 80, 100, 100, 50, 10)
    const b = boxBody("b", 5, 5, 200, 90, 90, 40, 10)
    const c = boxBody("c", 10, 10, 320, 70, 70, 30, 10)
    const { bodies } = settleBodies([c, a, b], room)
    expect(hasInterpenetration(bodies)).toBe(false)
    const za = bodies.find((body) => body.id === "a")!
    const zb = bodies.find((body) => body.id === "b")!
    const zc = bodies.find((body) => body.id === "c")!
    expect(za.cz - za.hz).toBeCloseTo(0, 5)
    expect(zb.cz - zb.hz).toBeCloseTo(50, 5)
    expect(zc.cz - zc.hz).toBeCloseTo(90, 5)
  })
})
