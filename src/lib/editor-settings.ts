"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { PhysicsSettings } from "@compass/physics"

export type EditorSettings = {
  strictMode: boolean
  clampToWalls: boolean
  minSupportPct: number
  colourBlindPalette: boolean
  moveRealPieceWhileDragging: boolean
}

const DEFAULTS: EditorSettings = {
  strictMode: true,
  clampToWalls: false,
  minSupportPct: 70,
  colourBlindPalette: false,
  moveRealPieceWhileDragging: false,
}

export const useEditorSettings = create<EditorSettings & { patch: (next: Partial<EditorSettings>) => void }>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      patch: (next) => set(next),
    }),
    { name: "compass-drag-settings" },
  ),
)

export function physicsFromSettings(settings: EditorSettings, maxPayloadKg: number | null = null): Partial<PhysicsSettings> {
  return {
    strictMode: settings.strictMode,
    clampToWalls: settings.clampToWalls,
    minSupportRatio: settings.minSupportPct / 100,
    blockOnWeightLimit: settings.strictMode,
    maxPayloadKg,
    toleranceCm: 0.1,
  }
}

export function ghostColors(colourBlind: boolean) {
  if (colourBlind) {
    return { valid: "#2563eb", invalid: "#ea580c" }
  }
  return { valid: "#22c55e", invalid: "#ef4444" }
}
