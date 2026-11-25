import { describe, expect, it } from "vitest"
import { boxBody, cylinderBody } from "./types"
import { DEFAULT_WORLD } from "./types"
import { validateDrop, type DropPiece } from "./validate-drop"

const world = { ...DEFAULT_WORLD, lengthCm: 500, widthCm: 240, heightCm: 250 }

function piece(
  id: string,
  x: number,
  y: number,
  z: number,
  l: number,
  w: number,
  h: number,
  extra: Partial<DropPiece> = {},
): DropPiece {
  return { ...boxBody(id, x, y, z, l, w, h, 50), name: id, ...extra }
}

describe("validateDrop with handling clearance", () => {
  it("behaves as before when no piece has an allowance", () => {
    const wall = piece("a", 100, 0, 0, 100, 100, 100)
    const flush = piece("b", 0, 0, 0, 100, 100, 100)
    const result = validateDrop(world, [wall, flush], flush, { x: 0, y: 0, z: 0 })
    expect(result.valid).toBe(true)
    const touching = piece("c", 200, 0, 0, 100, 100, 100)
    expect(validateDrop(world, [wall, touching], touching, { x: 200, y: 0, z: 0 }).valid).toBe(true)
  })

  it("rejects a piece whose allowance reaches past a wall instead of clipping it", () => {
    const moving = piece("a", 5, 20, 0, 100, 100, 100, { clearanceCm: 10 })
    const result = validateDrop(world, [moving], moving, { x: 5, y: 20, z: 0 })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("CLEARANCE")
    expect(result.message).toMatch(/past the wall/)
  })

  it("accepts a piece exactly one allowance from the wall", () => {
    const moving = piece("a", 10, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    expect(validateDrop(world, [moving], moving, { x: 10, y: 10, z: 0 }).valid).toBe(true)
  })

  it("keeps the shared gap between neighbours", () => {
    const other = piece("o", 10, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    const close = piece("m", 115, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    const rejected = validateDrop(world, [other, close], close, { x: 115, y: 10, z: 0 })
    expect(rejected.valid).toBe(false)
    expect(rejected.reason).toBe("CLEARANCE")
    const ok = piece("m", 120, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    expect(validateDrop(world, [other, ok], ok, { x: 120, y: 10, z: 0 }).valid).toBe(true)
  })

  it("uses a neighbour's allowance even when the moving piece has none", () => {
    const other = piece("o", 10, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    const plain = piece("m", 112, 10, 0, 100, 100, 100)
    expect(validateDrop(world, [other, plain], plain, { x: 112, y: 10, z: 0 }).reason).toBe("CLEARANCE")
  })

  it("does not ask for clearance between a piece and the one under it, and does not count it as support", () => {
    const base = piece("base", 10, 10, 0, 100, 100, 100, { clearanceCm: 10 })
    const on = piece("on", 10, 10, 100, 100, 100, 100, { clearanceCm: 10 })
    expect(validateDrop(world, [base, on], on, { x: 10, y: 10, z: 100 }).valid).toBe(true)
    // Overhanging into the base's clearance margin gives no extra support: only the physical overlap counts.
    const overhang = piece("over", 60, 10, 100, 100, 100, 100, { clearanceCm: 10 })
    const result = validateDrop(world, [base, overhang], overhang, { x: 60, y: 10, z: 100 })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("NO_SUPPORT")
  })

  it("applies to drums using their bounding square, like the solver", () => {
    const drumA = { ...cylinderBody("da", 10, 10, 0, 60, 60, 90, 80), name: "da", clearanceCm: 10 }
    const drumB = { ...cylinderBody("db", 75, 10, 0, 60, 60, 90, 80), name: "db", clearanceCm: 10 }
    expect(validateDrop(world, [drumA, drumB], drumB, { x: 75, y: 10, z: 0 }).reason).toBe("CLEARANCE")
    const farther = { ...drumB, cx: 80 + 30, cy: 10 + 30 }
    expect(validateDrop(world, [drumA, farther], farther, { x: 80, y: 10, z: 0 }).valid).toBe(true)
  })
})
