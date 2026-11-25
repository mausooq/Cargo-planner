"use client"

import { useState } from "react"
import { Info, Loader2, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CLEARANCE_HELP, MAX_CLEARANCE_CM, normaliseClearance } from "@/lib/clearance"

/**
 * The project's default handling allowance and the way into the per-line settings. With a calculated
 * plan, applying a change asks once whether to keep the current layout or recalculate (the parent
 * shows that choice), so there is no separate "Recalculate" afterwards. Nothing runs while typing.
 */
export function ClearanceSettings({
  value,
  canEdit,
  hasPlan,
  busy,
  status,
  planUsedCm,
  counts,
  onSave,
  onManage,
}: {
  /** The saved project default, per side in cm. */
  value: number
  canEdit: boolean
  hasPlan: boolean
  /** Saving or recalculating: every action here is off meanwhile. */
  busy: boolean
  /** What is happening right now, for example "Saving…" or "Recalculating the load plan…". */
  status: string | null
  /** The default the current plan was calculated with, when it differs from the saved one. */
  planUsedCm: number | null
  counts: { inherited: number; custom: number }
  onSave: (defaultCm: number) => void
  onManage: () => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(String(value))
  }
  const parsed = Number(draft)
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_CLEARANCE_CM
  const changed = valid && normaliseClearance(parsed) !== value

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-card px-3 py-2 text-sm">
      <Label htmlFor="project-clearance" className="flex items-center gap-1.5" title={CLEARANCE_HELP}>
        Handling allowance
        <Info className="size-3.5 text-muted-foreground" aria-hidden />
      </Label>
      {canEdit ? (
        <>
          <Input
            id="project-clearance"
            type="number"
            inputMode="decimal"
            min={0}
            max={MAX_CLEARANCE_CM}
            step={0.5}
            value={draft}
            disabled={busy}
            aria-invalid={!valid}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed && !busy) onSave(normaliseClearance(parsed))
            }}
            className="h-8 w-20 px-2 tabular-nums"
          />
          <span className="text-muted-foreground">cm per side</span>
          <Button type="button" size="sm" variant="outline" onClick={() => onSave(normaliseClearance(parsed))} disabled={!changed || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {hasPlan ? "Apply changes…" : "Save"}
          </Button>
          {!valid ? <span className="text-xs text-destructive">Enter 0 to {MAX_CLEARANCE_CM}.</span> : null}
        </>
      ) : (
        <span className="font-medium tabular-nums">{value > 0 ? `${value} cm per side` : "none"}</span>
      )}
      <Button type="button" size="sm" variant="outline" onClick={onManage} disabled={busy}>
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Manage clearances
      </Button>
      <span className="text-xs text-muted-foreground">
        {counts.inherited} line{counts.inherited === 1 ? "" : "s"} use the default · {counts.custom} custom
      </span>
      {status ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground" role="status" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {status}
        </span>
      ) : null}
      {planUsedCm !== null ? (
        <span className="basis-full text-xs text-amber-700 dark:text-amber-400">
          The current plan was calculated with {planUsedCm} cm; the saved default is {value} cm.
        </span>
      ) : (
        <span className="basis-full text-xs text-muted-foreground">
          Free space around each piece for forks, hands or lashing. Lines can override it in Manage clearances or on the Cargo page.
        </span>
      )}
    </div>
  )
}
