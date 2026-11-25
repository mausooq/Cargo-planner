"use client"

import { useSyncExternalStore } from "react"
import { isLengthUnit, type LengthUnit } from "@/lib/cargo-units"

/**
 * The unit sizes are shown and typed in. One browser-side preference for the whole app (the Cargo
 * grid, the plan pages, the equipment catalogue, the 3D labels), kept under the key the Cargo page
 * has always used, so an existing choice carries over. It is a display choice only: it is never
 * saved to a project and never changes a stored size or the status of a plan.
 */

export const LENGTH_UNIT_STORAGE_KEY = "compass.cargo.lengthUnit"
const CHANGE_EVENT = "compass-cargo-unit"

export function readLengthUnit(): LengthUnit {
  try {
    const stored = window.localStorage.getItem(LENGTH_UNIT_STORAGE_KEY)
    if (isLengthUnit(stored)) return stored
  } catch {
    // Storage blocked: fall back to centimetres.
  }
  return "cm"
}

export function writeLengthUnit(unit: LengthUnit) {
  try {
    window.localStorage.setItem(LENGTH_UNIT_STORAGE_KEY, unit)
  } catch {
    // Ignore: the choice just won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeLengthUnit(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange)
  window.addEventListener("storage", onStoreChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange)
    window.removeEventListener("storage", onStoreChange)
  }
}

/** The chosen unit; centimetres on the server and until the browser has read it. */
export function useLengthUnit(): LengthUnit {
  return useSyncExternalStore(subscribeLengthUnit, readLengthUnit, () => "cm" as LengthUnit)
}
