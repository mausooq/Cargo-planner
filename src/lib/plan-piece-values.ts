import { roundDisplayLength } from "@/lib/cargo-units"
import type { PlanItemView } from "@/lib/plan-view"

/**
 * The values to show for a loaded piece in step 4. The plan stores each piece as it was placed,
 * so a piece turned on the floor has its length and width swapped. People want to recognise the
 * line they typed in step 1, so the list shows the cargo line's own values, in the same form the
 * cargo table uses, and says separately when the piece was turned.
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
  /** True when the piece sits in the unit turned from the way it was entered. */
  turned: boolean
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.05

/** Entered values for a placed piece. Falls back to the placed values when the cargo line is gone. */
export function pieceValues(item: PlanItemView, cargo: Map<string, EnteredCargo>): PieceValues {
  const line = cargo.get(item.cargoId)
  if (!line) {
    return {
      sku: item.sku ?? null,
      name: item.name,
      lengthCm: item.lengthCm,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
      turned: false,
    }
  }
  const turned = !(same(item.lengthCm, line.lengthCm) && same(item.widthCm, line.widthCm) && same(item.heightCm, line.heightCm))
  return {
    sku: line.sku,
    name: line.name,
    lengthCm: line.lengthCm,
    widthCm: line.widthCm,
    heightCm: line.heightCm,
    weightKg: line.weightKg,
    turned,
  }
}

/** A size in cm, written the way the cargo table writes it (one decimal at most, no padding). */
export function formatEnteredLength(cm: number): string {
  if (!Number.isFinite(cm)) return ""
  return String(roundDisplayLength(cm, "cm"))
}

/** A weight in kg exactly as typed: no rounding and no thousands separator. */
export function formatEnteredWeight(kg: number): string {
  return Number.isFinite(kg) ? String(kg) : ""
}
