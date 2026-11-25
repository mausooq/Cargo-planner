import { NO_CLEARANCE, type Clearance4 } from "./footprint"

/**
 * Handling clearance as configured on a cargo line, and how it follows the piece when it turns.
 *
 * Three modes per line (a `ClearanceSetting`):
 *  - `null`            INHERIT      use the project default (and follow it when it changes)
 *  - a number          UNIFORM      the same free space on all four sides. `0` is an explicit "none"
 *                                   and is NOT the same as inheriting
 *  - `SideClearance`   DIRECTIONAL  independent front / rear / left / right values
 *
 * Directional values belong to the PIECE, in the orientation the cargo line was entered in
 * ("original orientation"): front is the end of its length that faces the front of the unit when
 * it is placed as entered (rotation `LWH`), rear faces the doors, left is the lower-y side and
 * right the higher-y side. They turn with the piece.
 *
 * Rotation codes are the solver's: `LWH` is as entered, `WLH` is turned a quarter turn about the
 * vertical (clockwise seen from above, so its front faces the left wall). Two more flat states,
 * `LWH@180` and `WLH@180`, are the same two footprints turned half a turn further, so that a piece
 * with directional values can face the other way. For uniform values these four states are
 * indistinguishable and only the plain codes are ever used.
 *
 * Tipped codes (`LHW`, `HLW`, `WHL`, `HWL`: the height no longer vertical): the piece's own faces
 * no longer line up with the four plan sides in any way the entered front/rear/left/right
 * describe, and some of those faces now point up or down where floor clearance has no meaning.
 * Nothing is discarded: the LARGEST of the four values is applied on every side. This is
 * conservative (it never reserves less than any entered value) and does not depend on which way
 * the piece was tipped.
 */

export const MAX_CLEARANCE_CM = 100

export type SideClearance = { front: number; rear: number; left: number; right: number }
export type ClearanceSetting = null | number | SideClearance
export type ClearanceMode = "INHERIT" | "UNIFORM" | "DIRECTIONAL"

function clean(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim() === "" ? Number.NaN : value) : value
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null
  return Math.min(MAX_CLEARANCE_CM, Math.round(n * 10) / 10)
}

/** A well-formed set of four sides from loose input, or null if any value is missing, negative or not a number. */
export function normaliseSides(raw: unknown): SideClearance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const front = clean(row.front)
  const rear = clean(row.rear)
  const left = clean(row.left)
  const right = clean(row.right)
  if (front === null || rear === null || left === null || right === null) return null
  return { front, rear, left, right }
}

export function uniformSides(value: number): SideClearance {
  return { front: value, rear: value, left: value, right: value }
}

export function sidesAreUniform(sides: SideClearance): boolean {
  return sides.front === sides.rear && sides.rear === sides.left && sides.left === sides.right
}

export function maxSide(sides: SideClearance): number {
  return Math.max(sides.front, sides.rear, sides.left, sides.right)
}

/** A clean setting from loose input: sides win, then a number, otherwise inherit. Invalid input inherits. */
export function normaliseSetting(input: { clearanceCm?: unknown; clearanceSides?: unknown } | null | undefined): ClearanceSetting {
  if (!input) return null
  const sides = normaliseSides(input.clearanceSides)
  if (sides) return sides
  return clean(input.clearanceCm)
}

export function modeOf(setting: ClearanceSetting): ClearanceMode {
  if (setting === null) return "INHERIT"
  return typeof setting === "number" ? "UNIFORM" : "DIRECTIONAL"
}

/** The four values a setting means for a piece, with `projectDefault` filling in for INHERIT. */
export function resolveSides(setting: ClearanceSetting, projectDefault: number): SideClearance {
  if (setting === null) return uniformSides(Math.max(0, projectDefault))
  if (typeof setting === "number") return uniformSides(Math.max(0, setting))
  return setting
}

export function sameSetting(a: ClearanceSetting, b: ClearanceSetting): boolean {
  if (a === null || b === null) return a === b
  if (typeof a === "number" || typeof b === "number") return a === b
  return a.front === b.front && a.rear === b.rear && a.left === b.left && a.right === b.right
}

/** Short words for the cargo grid and the panels, for example "Default · 5 cm" or "Directional". */
export function describeSetting(setting: ClearanceSetting, projectDefault: number): string {
  if (setting === null) return `Default · ${projectDefault} cm`
  if (typeof setting === "number") return setting === 0 ? "Custom · 0 cm" : `Uniform · ${setting} cm`
  return "Directional"
}

/** "F 20 · R 5 · L 10 · R 5" style detail for a directional setting. */
export function describeSides(sides: SideClearance): string {
  return `Front ${sides.front} · Rear ${sides.rear} · Left ${sides.left} · Right ${sides.right} cm`
}

// ---- rotation -------------------------------------------------------------------------------

const FLAT: Record<string, number> = { LWH: 0, WLH: 1 }

export type ParsedRotation = {
  /** Which entered axes lie along x, y, z (the part before any `@`). */
  axes: string
  /** Quarter turns about the vertical, 0 to 3, or null when the piece is tipped (or unreadable). */
  turns: 0 | 1 | 2 | 3 | null
}

export function parseRotation(code: string | null | undefined): ParsedRotation {
  const text = (code ?? "LWH").trim()
  const [axes = "LWH", extra] = text.split("@")
  const base = FLAT[axes]
  if (base === undefined) return { axes, turns: null }
  if (extra !== undefined && extra !== "180") return { axes, turns: null }
  const turns = (base + (extra === "180" ? 2 : 0)) % 4
  return { axes, turns: turns as 0 | 1 | 2 | 3 }
}

/** A rotation code in words, for reports: how the piece faces compared with the way it was entered. */
export function describeRotation(code: string | null | undefined): string {
  const { turns } = parseRotation(code)
  if (turns === null) return "Tipped onto another face"
  return ["As entered", "Turned 90°", "Turned 180°", "Turned 270°"][turns] ?? "As entered"
}

/** The rotation code for a number of quarter turns (0 = as entered). */
export function flatRotationCode(turns: number): string {
  const t = ((Math.round(turns) % 4) + 4) % 4
  return t === 0 ? "LWH" : t === 1 ? "WLH" : t === 2 ? "LWH@180" : "WLH@180"
}

/** The rotation a flat piece takes after one more quarter turn, or null when the piece is tipped. */
export function nextQuarterTurn(code: string): string | null {
  const parsed = parseRotation(code)
  return parsed.turns === null ? null : flatRotationCode(parsed.turns + 1)
}

/**
 * The free space on each placed side for a piece with these own-side values in this rotation.
 * Quarter turns are clockwise seen from above: a piece's front, facing -x as entered, then faces
 * -y, +x, +y.
 */
export function placedSides(local: SideClearance, rotation: string | null | undefined): Clearance4 {
  if (sidesAreUniform(local)) {
    return local.front > 0 ? { x0: local.front, x1: local.front, y0: local.front, y1: local.front } : NO_CLEARANCE
  }
  const { turns } = parseRotation(rotation)
  if (turns === null) {
    const all = maxSide(local)
    return { x0: all, x1: all, y0: all, y1: all }
  }
  const { front, rear, left, right } = local
  switch (turns) {
    case 0:
      return { x0: front, x1: rear, y0: left, y1: right }
    case 1:
      return { x0: right, x1: left, y0: front, y1: rear }
    case 2:
      return { x0: rear, x1: front, y0: right, y1: left }
    default:
      return { x0: left, x1: right, y0: rear, y1: front }
  }
}

/** True when a piece's four values differ, so which way it faces matters. */
export function isDirectional(local: SideClearance): boolean {
  return !sidesAreUniform(local)
}

/**
 * Whether a piece may take a half-turn variant of a flat rotation. `FIXED` pieces keep the
 * orientation they were entered in; every other orientation rule allows facing either way.
 */
export function allowsHalfTurn(orientation: string): boolean {
  return orientation !== "FIXED"
}
