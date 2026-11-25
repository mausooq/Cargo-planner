import { describeRotation, parseRotation } from "@compass/physics"
import { LENGTH_UNIT_SYMBOL, roundDisplayLength, toDisplayLength, type LengthUnit } from "@/lib/cargo-units"
import { formatEnvelope } from "@/lib/format"
import type { PlanItemView } from "@/lib/plan-view"

/**
 * The values to show for a loaded piece in step 4. The plan stores each piece as it was placed,
 * so a piece turned on the floor has its length and width swapped. People want to recognise the
 * line they typed in step 1, so the list shows the piece in its entered order, in the same form the
 * cargo table uses, and says separately when the piece was turned.
 *
 * Where the values come from:
 *  - The piece's own saved size and rotation always say what was calculated: the entered order is
 *    the placed size read back through the rotation code. That is what a saved plan shows.
 *  - The cargo line (step 1) is used for the exact typed numbers, the name and the mark, but only when
 *    the plan is up to date and the line agrees with the piece. A plan that is out of date, or a line
 *    that was edited after the calculation, never changes what the saved plan shows: the table would
 *    otherwise present today's cargo data as if it were what was packed.
 */

export type EnteredCargo = {
  id: string
  sku: string | null
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
}

export type PieceValues = {
  sku: string | null
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  /** True when the piece sits in the unit differently from the way it was entered (turned, faced the other way, or tipped). */
  turned: boolean
  /** The rotation in words ("Turned 90°", "Turned 180°", "Tipped onto another face"), or null when it is as entered. */
  facing: string | null
  /** Where the sizes came from: the cargo line as entered, or the saved plan itself. */
  source: "entered" | "plan"
}

export type PieceValueOptions = {
  /** False when the saved plan is out of date, so the cargo list must not stand in for what was calculated. Default true. */
  planCurrent?: boolean
}

const TOLERANCE_CM = 0.05
const same = (a: number, b: number) => Math.abs(a - b) < TOLERANCE_CM

/**
 * The entered length, width and height of a placed piece. `axes` says which entered axis lies along
 * x, y and z ("LWH" as entered, "WLH" turned a quarter turn, other orders when tipped), so each entered
 * size is read from the placed size on that axis. Null when the code is not one we can read.
 */
function enteredFromPlaced(item: PlanItemView): { lengthCm: number; widthCm: number; heightCm: number } | null {
  const { axes } = parseRotation(item.rotation)
  if (axes.length !== 3 || ![..."LWH"].every((letter) => axes.includes(letter))) return null
  const placed = [item.lengthCm, item.widthCm, item.heightCm]
  const pick = (letter: string) => placed[axes.indexOf(letter)]!
  return { lengthCm: pick("L"), widthCm: pick("W"), heightCm: pick("H") }
}

/** Entered values for a placed piece. Falls back to the saved plan's own values when the cargo line is gone or no longer matches. */
export function pieceValues(item: PlanItemView, cargo: Map<string, EnteredCargo>, options: PieceValueOptions = {}): PieceValues {
  const { planCurrent = true } = options
  const parsed = parseRotation(item.rotation)
  const fromPlan = enteredFromPlaced(item) ?? { lengthCm: item.lengthCm, widthCm: item.widthCm, heightCm: item.heightCm }
  const readable = enteredFromPlaced(item) !== null
  const turned = readable ? parsed.turns !== 0 : false
  const facing = turned ? describeRotation(item.rotation) : null

  const line = planCurrent ? cargo.get(item.cargoId) : undefined
  const agrees =
    line !== undefined &&
    same(line.lengthCm, fromPlan.lengthCm) &&
    same(line.widthCm, fromPlan.widthCm) &&
    same(line.heightCm, fromPlan.heightCm) &&
    same(line.weightKg, item.weightKg)
  if (line && agrees) {
    return {
      sku: line.sku,
      name: line.name,
      lengthCm: line.lengthCm,
      widthCm: line.widthCm,
      heightCm: line.heightCm,
      weightKg: line.weightKg,
      turned,
      facing,
      source: "entered",
    }
  }
  return {
    sku: item.sku ?? null,
    name: item.name,
    ...fromPlan,
    weightKg: item.weightKg,
    turned,
    facing,
    source: "plan",
  }
}

/** A size written the way the cargo table writes it in the chosen unit (no padding, rounded only for showing). */
export function formatEnteredLength(cm: number, unit: LengthUnit = "cm"): string {
  if (!Number.isFinite(cm)) return ""
  return String(roundDisplayLength(toDisplayLength(cm, unit), unit))
}

/** A weight in kg exactly as typed: no rounding and no thousands separator. Weight is never converted. */
export function formatEnteredWeight(kg: number): string {
  return Number.isFinite(kg) ? String(kg) : ""
}

/** The tooltip on the Turned tag, in the chosen unit: how the piece faces and the space it takes in the unit. */
export function turnedTitle(item: Pick<PlanItemView, "lengthCm" | "widthCm" | "heightCm">, facing: string | null, unit: LengthUnit): string {
  const space = formatEnvelope(item.lengthCm, item.widthCm, item.heightCm, unit)
  return `Loaded ${facing ? facing.toLowerCase() : "turned"}: it takes up ${space} in the unit`
}

/** The unit symbol for a column title, kept next to the formatter so the two cannot drift. */
export const lengthTitle = (letter: string, unit: LengthUnit) => `${letter} (${LENGTH_UNIT_SYMBOL[unit]})`
