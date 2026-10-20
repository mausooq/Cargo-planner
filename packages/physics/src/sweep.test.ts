import { describe, expect, it } from "vitest"
import { sweepMove } from "./sweep"
import { insideWorld } from "./world"
import { DEFAULT_WORLD, boxBody } from "./types"

const room = { ...DEFAULT_WORLD, lengthCm: 400, widthCm: 200, heightCm: 200 }

describe("swept movement", () => {
  it("stops a box at the end wall instead of tunnelling through", () => {
    const box = boxBody("a", 350, 50, 0, 40, 40, 40)
    const hit = sweepMove(box, { x: 80, y: 0, z: 0 }, [], room)
    expect(hit.hit).toBe(true)
    expect(hit.body.cx + hit.body.hx).toBeLessThanOrEqual(400 + room.toleranceCm)
    expect(insideWorld(hit.body, room)).toBe(true)
  })

  it("slides along a wall when the move is diagonal into it", () => {
    const box = boxBody("a", 10, 150, 0, 40, 40, 40)
    const hit = sweepMove(box, { x: 50, y: 80, z: 0 }, [], room)
    expect(hit.body.cy + hit.body.hy).toBeLessThanOrEqual(200 + room.toleranceCm)
    expect(hit.body.cx).toBeGreaterThan(box.cx)
  })

  it("does not walk through another box", () => {
    const mover = boxBody("a", 0, 0, 0, 40, 40, 40)
    const wall = boxBody("b", 80, 0, 0, 40, 40, 40)
    const hit = sweepMove(mover, { x: 80, y: 0, z: 0 }, [wall], room)
    expect(hit.hit).toBe(true)
    expect(hit.body.cx + hit.body.hx).toBeLessThanOrEqual(wall.cx - wall.hx + room.toleranceCm + 0.2)
  })
})
