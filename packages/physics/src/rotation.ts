/**
 * Rotation codes of a placed piece. A code says which of the piece's entered axes (L, W, H) lie
 * along x, y and z in the unit, plus which way the piece faces:
 *
 *   `LWH`      as entered
 *   `WLH`      a quarter turn about the vertical (length and width swapped)
 *   `LWH@180`  a half turn: same footprint as entered, facing the other way
 *   `WLH@180`  three quarter turns
 *   other orders of L, W, H (for example `LHW`) are tipped onto another face
 *
 * Older plans were saved with the plain codes and newer ones can carry the `@180` forms. All of them
 * stay readable. The facing does not change what a piece occupies, so it never affects floor use,
 * collisions or support; it is only reported (the Turned tag and the Excel export) and kept
 * consistent when a piece is turned again.
 */

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
 * The code after turning a piece one quarter turn on the floor, which swaps its length and width
 * on the floor (the caller swaps the sizes).
 *  - As entered or turned once, it flips between `LWH` and `WLH`, as the Playground always did.
 *  - A piece an older plan saved with a half-turn facing keeps going round (`LWH@180` then `WLH@180`,
 *    then back to `LWH`), so its code always agrees with its sizes.
 *  - A tipped piece swaps the first two axes of its code, which is exactly what a quarter turn does.
 */
export function nextFlatRotation(code: string | null | undefined): string {
  const { axes, turns } = parseRotation(code)
  if (turns === 0) return "WLH"
  if (turns === 1) return "LWH"
  if (turns === 2 || turns === 3) return flatRotationCode(turns + 1)
  // Tipped: swap the first two axes, keep the third.
  const [first, second, third] = axes
  const valid = axes.length === 3 && ["L", "W", "H"].every((letter) => axes.includes(letter))
  return valid && first && second && third ? `${second}${first}${third}` : "LWH"
}

/**
 * Whether a piece may take a half-turn variant of a flat rotation. `FIXED` pieces keep the
 * orientation they were entered in; every other orientation rule allows facing either way.
 */
export function allowsHalfTurn(orientation: string): boolean {
  return orientation !== "FIXED"
}
