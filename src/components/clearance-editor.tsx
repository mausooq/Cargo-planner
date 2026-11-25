"use client"

import { useState } from "react"
import {
  describeSetting,
  MAX_CLEARANCE_CM,
  uniformSides,
  type ClearanceMode,
  type ClearanceSetting,
  type SideClearance,
} from "@compass/physics"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CLEARANCE_HELP } from "@/lib/clearance"
import { formatEnvelope } from "@/lib/format"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { cn } from "@/lib/utils"

/** What the editor needs to know about a cargo line. */
export type ClearanceLine = {
  id: string
  sku?: string | null
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  quantity: number
}

type Draft = { mode: ClearanceMode; uniform: string; sides: Record<keyof SideClearance, string> }

const SIDE_LABELS: { key: keyof SideClearance; label: string; hint: string }[] = [
  { key: "front", label: "Front", hint: "The end that faces the front of the unit as the cargo is entered" },
  { key: "rear", label: "Rear", hint: "The opposite end, facing the doors as entered" },
  { key: "left", label: "Left", hint: "The left side, towards the left wall as entered" },
  { key: "right", label: "Right", hint: "The right side, towards the right wall as entered" },
]

function draftFrom(setting: ClearanceSetting, projectDefault: number): Draft {
  const text = (value: number) => String(value)
  if (setting === null) {
    return { mode: "INHERIT", uniform: text(projectDefault), sides: sidesText(uniformSides(projectDefault)) }
  }
  if (typeof setting === "number") return { mode: "UNIFORM", uniform: text(setting), sides: sidesText(uniformSides(setting)) }
  return { mode: "DIRECTIONAL", uniform: text(Math.max(setting.front, setting.rear, setting.left, setting.right)), sides: sidesText(setting) }
}

function sidesText(sides: SideClearance): Draft["sides"] {
  return { front: String(sides.front), rear: String(sides.rear), left: String(sides.left), right: String(sides.right) }
}

/** A value from a text box: 0 to the maximum, or null when it is empty, negative or not a number. */
function parseCm(text: string): number | null {
  if (text.trim() === "") return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || value > MAX_CLEARANCE_CM) return null
  return Math.round(value * 10) / 10
}

/** The setting the draft describes, or null when something in it is not valid yet. Inherit is `{ ok: true, setting: null }`. */
export function settingFromDraft(draft: Draft): { ok: true; setting: ClearanceSetting } | { ok: false } {
  if (draft.mode === "INHERIT") return { ok: true, setting: null }
  if (draft.mode === "UNIFORM") {
    const value = parseCm(draft.uniform)
    return value === null ? { ok: false } : { ok: true, setting: value }
  }
  const front = parseCm(draft.sides.front)
  const rear = parseCm(draft.sides.rear)
  const left = parseCm(draft.sides.left)
  const right = parseCm(draft.sides.right)
  if (front === null || rear === null || left === null || right === null) return { ok: false }
  return { ok: true, setting: { front, rear, left, right } }
}

/**
 * The one clearance editor, used on the Cargo page, in Manage clearances and in the Playground.
 * It edits a cargo line's setting only; the caller decides when it is saved. Directional values are
 * as the cargo is entered and turn with the piece.
 */
export function ClearanceEditorDialog({
  open,
  onOpenChange,
  line,
  setting,
  projectDefault,
  onApply,
  applyLabel = "Save",
  scopeNote,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: ClearanceLine
  setting: ClearanceSetting
  projectDefault: number
  onApply: (setting: ClearanceSetting) => void
  applyLabel?: string
  /** Replaces the default sentence about how many pieces the change reaches. */
  scopeNote?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        {/* Remount on open so the fields always start from the saved setting. */}
        {open ? (
          <EditorBody
            line={line}
            setting={setting}
            projectDefault={projectDefault}
            applyLabel={applyLabel}
            scopeNote={scopeNote}
            onCancel={() => onOpenChange(false)}
            onApply={(next) => {
              onApply(next)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditorBody({
  line,
  setting,
  projectDefault,
  applyLabel,
  scopeNote,
  onCancel,
  onApply,
}: {
  line: ClearanceLine
  setting: ClearanceSetting
  projectDefault: number
  applyLabel: string
  scopeNote?: string
  onCancel: () => void
  onApply: (setting: ClearanceSetting) => void
}) {
  const lengthUnit = useLengthUnit()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(setting, projectDefault))
  const result = settingFromDraft(draft)
  const preview: SideClearance | null = result.ok
    ? result.setting === null
      ? uniformSides(projectDefault)
      : typeof result.setting === "number"
        ? uniformSides(result.setting)
        : result.setting
    : null
  const pieces = line.quantity === 1 ? "the 1 piece" : `all ${line.quantity} pieces`

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Clearance: {line.name || "Cargo line"}
          {line.sku ? <span className="ml-2 text-sm font-normal text-muted-foreground">{line.sku}</span> : null}
        </DialogTitle>
        <DialogDescription>
          Size {formatEnvelope(line.lengthCm, line.widthCm, line.heightCm, lengthUnit)} · {round(line.weightKg)} kg per piece · quantity {line.quantity}
        </DialogDescription>
      </DialogHeader>

      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Clearance values are always in centimetres, whichever unit sizes are shown in. {scopeNote ?? `A change here applies to ${pieces} of this cargo line.`} It reserves handling space; it does not add packaging, weight or volume, and it never counts as something to rest on.
      </p>

      <fieldset className="space-y-2" aria-label="Clearance mode">
        <ModeOption
          checked={draft.mode === "INHERIT"}
          onSelect={() => setDraft({ ...draft, mode: "INHERIT" })}
          title={`Use the project default (${projectDefault} cm)`}
          detail="Follows the project's handling allowance if it changes later."
        />
        <ModeOption
          checked={draft.mode === "UNIFORM"}
          onSelect={() => setDraft({ ...draft, mode: "UNIFORM" })}
          title="Custom, the same on every side"
          detail="Overrides the project default. 0 means no clearance for this line, even if the project has one."
        >
          {draft.mode === "UNIFORM" ? (
            <CmField label="All sides" value={draft.uniform} onChange={(uniform) => setDraft({ ...draft, uniform })} />
          ) : null}
        </ModeOption>
        <ModeOption
          checked={draft.mode === "DIRECTIONAL"}
          onSelect={() => setDraft({ ...draft, mode: "DIRECTIONAL" })}
          title="Custom, set for each side"
          detail="As the cargo is entered. The values turn with the piece when it is rotated."
        >
          {draft.mode === "DIRECTIONAL" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SIDE_LABELS.map(({ key, label, hint }) => (
                <CmField
                  key={key}
                  label={label}
                  title={hint}
                  value={draft.sides[key]}
                  onChange={(value) => setDraft({ ...draft, sides: { ...draft.sides, [key]: value } })}
                />
              ))}
            </div>
          ) : null}
        </ModeOption>
      </fieldset>

      {!result.ok ? <p className="text-sm text-destructive">Enter each value from 0 to {MAX_CLEARANCE_CM} cm.</p> : null}

      <TopViewDiagram line={line} sides={preview} />

      <p className="text-xs text-muted-foreground">{CLEARANCE_HELP}</p>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setDraft(draftFrom(null, projectDefault))} disabled={draft.mode === "INHERIT"}>
          Restore project default
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => result.ok && onApply(result.setting)} disabled={!result.ok}>
            {applyLabel}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

function ModeOption({
  checked,
  onSelect,
  title,
  detail,
  children,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2", checked ? "border-primary bg-primary/5" : "bg-card")}>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" className="mt-1" checked={checked} onChange={onSelect} />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </label>
      {children ? <div className="mt-2 pl-6">{children}</div> : null}
    </div>
  )
}

function CmField({ label, value, onChange, title }: { label: string; value: string; onChange: (value: string) => void; title?: string }) {
  const invalid = parseCm(value) === null
  return (
    <div className="space-y-1" title={title}>
      <Label className="text-xs">{label} (cm)</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={MAX_CLEARANCE_CM}
        step="any"
        value={value}
        aria-invalid={invalid}
        aria-label={`${label} clearance in centimetres`}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 px-2 tabular-nums"
      />
    </div>
  )
}

/**
 * The cargo seen from above, as entered: front towards the left of the drawing, doors to the right.
 * Blue is the physical cargo, amber the free space reserved around it, so the sides are easy to tell apart.
 */
export function TopViewDiagram({ line, sides, compact = false }: { line: Pick<ClearanceLine, "lengthCm" | "widthCm">; sides: SideClearance | null; compact?: boolean }) {
  const width = compact ? 220 : 340
  const height = compact ? 120 : 170
  const s = sides ?? uniformSides(0)
  const l = Math.max(1, line.lengthCm)
  const w = Math.max(1, line.widthCm)
  // Draw to scale, with the reserved space growing the picture; leave room for labels.
  const totalL = l + s.front + s.rear
  const totalW = w + s.left + s.right
  const pad = 26
  const scale = Math.min((width - 2 * pad) / totalL, (height - 2 * pad) / totalW)
  const ox = (width - totalL * scale) / 2
  const oy = (height - totalW * scale) / 2
  const cargo = { x: ox + s.front * scale, y: oy + s.left * scale, w: l * scale, h: w * scale }
  const text = "fill-muted-foreground text-[10px]"
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-md" role="img" aria-label="Top view of the cargo with its clearance on each side">
      <rect x={ox} y={oy} width={totalL * scale} height={totalW * scale} className="fill-amber-500/15 stroke-amber-500" strokeDasharray="4 3" />
      <rect x={cargo.x} y={cargo.y} width={cargo.w} height={cargo.h} className="fill-primary/20 stroke-primary" />
      <text x={cargo.x + cargo.w / 2} y={cargo.y + cargo.h / 2} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-[10px]">
        cargo
      </text>
      <text x={ox + (s.front * scale) / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" className={text}>
        {s.front > 0 ? `F ${s.front}` : "F 0"}
      </text>
      <text x={cargo.x + cargo.w + (s.rear * scale) / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" className={text}>
        {s.rear > 0 ? `R ${s.rear}` : "R 0"}
      </text>
      <text x={width / 2} y={oy + (s.left * scale) / 2} textAnchor="middle" dominantBaseline="middle" className={text}>
        {s.left > 0 ? `L ${s.left}` : "L 0"}
      </text>
      <text x={width / 2} y={cargo.y + cargo.h + (s.right * scale) / 2} textAnchor="middle" dominantBaseline="middle" className={text}>
        {s.right > 0 ? `Rt ${s.right}` : "Rt 0"}
      </text>
      <text x={6} y={height - 6} className={text}>
        ← front of unit (as entered)
      </text>
      <text x={width - 6} y={height - 6} textAnchor="end" className={text}>
        doors →
      </text>
    </svg>
  )
}

/** Short label for a cargo line's setting, such as "Default · 5 cm", "Uniform · 10 cm" or "Directional". */
export function settingLabel(setting: ClearanceSetting, projectDefault: number): string {
  return describeSetting(setting, projectDefault)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
