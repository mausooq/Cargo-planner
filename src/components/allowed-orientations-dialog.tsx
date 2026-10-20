"use client"

import { useEffect, useState } from "react"
import {
  AXIS_ROTATIONS,
  orientationMask,
  presetRotations,
  type AxisRotation,
  type Orientation,
} from "@compass/domain"
import { Button } from "@/components/ui/button"

const CHOICES: { id: "ROTATE_90" | "LONGSHIP" | "TILTABLE" | "CUSTOM"; label: string }[] = [
  { id: "ROTATE_90", label: "Rotatable" },
  { id: "LONGSHIP", label: "Longship" },
  { id: "TILTABLE", label: "Tiltable" },
  { id: "CUSTOM", label: "Custom..." },
]

const AXIS_LABEL: Record<AxisRotation, string> = {
  LWH: "L × W × H",
  WLH: "W × L × H",
  LHW: "L × H × W",
  HLW: "H × L × W",
  HWL: "H × W × L",
  WHL: "W × H × L",
}

const GLYPH: Record<AxisRotation, { width: number; height: number; transform: string }> = {
  LWH: { width: 96, height: 36, transform: "rotateX(52deg) rotateZ(-16deg)" },
  WLH: { width: 28, height: 78, transform: "rotateX(52deg) rotateZ(-16deg)" },
  LHW: { width: 96, height: 28, transform: "rotateX(68deg) rotateZ(-8deg)" },
  HLW: { width: 34, height: 70, transform: "rotateZ(-72deg)" },
  HWL: { width: 42, height: 40, transform: "rotateZ(16deg)" },
  WHL: { width: 22, height: 84, transform: "rotateZ(-10deg)" },
}

const COLUMNS: AxisRotation[][] = [
  ["LWH", "LHW", "HWL"],
  ["WLH", "HLW", "WHL"],
]

export function orientationChoice(orientation: Orientation): (typeof CHOICES)[number]["id"] {
  if (orientation === "CUSTOM") return "CUSTOM"
  if (orientation === "LONGSHIP" || orientation === "FIXED") return "LONGSHIP"
  if (orientation === "TILTABLE" || orientation === "ANY") return "TILTABLE"
  return "ROTATE_90"
}

export function orientationMenuLabel(orientation: Orientation): string {
  return CHOICES.find((choice) => choice.id === orientationChoice(orientation))?.label ?? "Rotatable"
}

export function presetFor(codes: readonly AxisRotation[]): "ROTATE_90" | "LONGSHIP" | "TILTABLE" | null {
  const mask = orientationMask(codes)
  if (mask === orientationMask(presetRotations("ROTATE_90"))) return "ROTATE_90"
  if (mask === orientationMask(presetRotations("LONGSHIP")) && codes.length === 1) return "LONGSHIP"
  if (mask === orientationMask(presetRotations("TILTABLE"))) return "TILTABLE"
  return null
}

export function activeRotations(orientation: Orientation, allowed: AxisRotation[] | null): AxisRotation[] {
  if (orientation === "CUSTOM" && allowed && allowed.length > 0) return allowed
  return presetRotations(orientation === "CUSTOM" ? "ROTATE_90" : orientation)
}

export function OrientationSelect({
  orientation,
  disabled,
  onPreset,
  onCustom,
}: {
  orientation: Orientation
  disabled: boolean
  onPreset: (orientation: "ROTATE_90" | "LONGSHIP" | "TILTABLE") => void
  onCustom: () => void
}) {
  return (
    <select
      aria-label="Orientations"
      className="h-8 w-full min-w-28 rounded-md border bg-background px-1 text-xs"
      value={orientationChoice(orientation)}
      disabled={disabled}
      onChange={(event) => {
        const value = event.target.value
        if (value === "CUSTOM") {
          onCustom()
          return
        }
        if (value === "ROTATE_90" || value === "LONGSHIP" || value === "TILTABLE") onPreset(value)
      }}
    >
      {CHOICES.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

export function AllowedOrientationsDialog({
  name,
  initial,
  onCancel,
  onSave,
}: {
  name: string
  initial: AxisRotation[]
  onCancel: () => void
  onSave: (codes: AxisRotation[]) => void
}) {
  const [selected, setSelected] = useState<AxisRotation[]>(initial.length > 0 ? initial : ["LWH", "WLH"])
  const label = describeSelection(selected)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  function toggle(code: AxisRotation) {
    setSelected((current) =>
      current.includes(code) ? current.filter((entry) => entry !== code) : AXIS_ROTATIONS.filter((entry) => entry === code || current.includes(entry)),
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-md border bg-card shadow-lg" role="dialog" aria-label="Allowed orientations">
        <div className="flex items-center justify-between border-b bg-primary px-4 py-2 text-primary-foreground">
          <h2 className="text-sm font-semibold">Allowed orientations</h2>
          <button type="button" className="px-2 text-lg leading-none" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4">
          <p className="rounded-md border border-primary/40 bg-accent px-3 py-2 text-sm">
            <span className="font-medium">{label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Value: {orientationMask(selected)}</span>
          </p>
          <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {COLUMNS.map((column) => (
              <div key={column.join()} className="space-y-5">
                {column.map((code) => (
                  <label key={code} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(code)}
                      onChange={() => toggle(code)}
                      aria-label={AXIS_LABEL[code]}
                    />
                    <span className="w-20 text-sm">{AXIS_LABEL[code]}</span>
                    <OrientationGlyph code={code} name={name || "BOX"} />
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={selected.length === 0} onClick={() => onSave(selected)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

function describeSelection(codes: AxisRotation[]): string {
  const mask = orientationMask(codes)
  if (mask === orientationMask(presetRotations("ROTATE_90"))) return "Rotatable"
  if (mask === orientationMask(presetRotations("LONGSHIP"))) return "Longship"
  if (mask === orientationMask(presetRotations("TILTABLE"))) return "Tiltable"
  return "Custom"
}

function OrientationGlyph({ code, name }: { code: AxisRotation; name: string }) {
  const pose = GLYPH[code]
  return (
    <span className="flex h-20 w-28 items-center justify-center" style={{ perspective: 240 }}>
      <span
        className="flex items-center justify-center overflow-hidden border border-amber-700/40 bg-amber-400 text-center text-[10px] font-bold tracking-wide text-neutral-950 shadow-sm"
        style={{ width: pose.width, height: pose.height, transform: pose.transform }}
      >
        <span className="px-1 leading-tight">{name}</span>
      </span>
    </span>
  )
}
