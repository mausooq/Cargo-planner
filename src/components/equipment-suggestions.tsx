"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { CargoLine } from "@/components/cargo-grid"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { suggestEquipment, type EquipmentSuggestion, type Objective, type SuggestProgress } from "@/lib/equipment-suggest"
import { formatCost, formatPct } from "@/lib/format"
import { runSolver } from "@/lib/run-solver"
import { cn } from "@/lib/utils"

const SHOWN = 5

/**
 * "Which equipment is best for my cargo?" Runs a quick packing trial of the cargo against every
 * candidate type and lists the best fits, each with a one-click "Use this".
 */
export function EquipmentSuggestions({
  cargo,
  candidates,
  scopeLabel,
  objective,
  canEdit,
  selected,
  onUse,
}: {
  cargo: CargoLine[]
  candidates: EquipmentListItem[]
  /** What is being compared, e.g. "Sea" or "all". Shown in the button and summary. */
  scopeLabel: string
  objective: Objective
  canEdit: boolean
  selected: { equipmentTypeId: string; quantity: number }[]
  onUse: (equipmentTypeId: string, units: number) => void
}) {
  const [progress, setProgress] = useState<SuggestProgress | null>(null)
  const [results, setResults] = useState<{ signature: string; ranked: EquipmentSuggestion[]; checked: number } | null>(null)
  const cancelled = useRef(false)

  // The results only describe one exact cargo list and set of types; anything else makes them stale.
  const signature = useMemo(
    () =>
      JSON.stringify([
        objective,
        candidates.map((item) => item.id),
        cargo.map((line) => [line.id, line.lengthCm, line.widthCm, line.heightCm, line.weightKg, line.quantity, line.stackable, line.orientation]),
      ]),
    [cargo, candidates, objective],
  )
  const current = results && results.signature === signature ? results : null
  const stale = Boolean(results) && !current

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  async function run() {
    if (cargo.length === 0) {
      toast.error("Add cargo first, then I can find the best equipment for it.")
      return
    }
    cancelled.current = false
    setProgress({ done: 0, total: candidates.length, current: "" })
    try {
      const ranked = await suggestEquipment({
        cargo,
        candidates,
        objective,
        run: (input) => runSolver(input),
        onProgress: (next) => {
          if (!cancelled.current) setProgress(next)
        },
        isCancelled: () => cancelled.current,
      })
      if (cancelled.current) return
      setResults({ signature, ranked, checked: candidates.length })
    } catch {
      toast.error("Could not compare the equipment. Try again.")
    } finally {
      if (!cancelled.current) setProgress(null)
    }
  }

  const running = progress !== null
  const complete = current?.ranked.filter((entry) => entry.unloadedPieces === 0) ?? []
  const shown = current ? (complete.length > 0 ? complete : current.ranked).slice(0, SHOWN) : []

  return (
    <section className="rounded-md border bg-card p-4" aria-label="Equipment suggestions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Not sure which equipment to pick?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compass test-packs your cargo into each of the {candidates.length} {scopeLabel} types and shows the best fits
            {objective === "LOWEST_COST" ? " (lowest total cost first)" : " (standard types first, then fewest units, lowest cost, and the fullest load)"}.
          </p>
        </div>
        {running ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              cancelled.current = true
              setProgress(null)
            }}
          >
            Stop
          </Button>
        ) : (
          <Button type="button" variant={current ? "outline" : "default"} onClick={() => void run()} disabled={candidates.length === 0}>
            <Sparkles className="size-4" />
            {current || stale ? "Check again" : "Find the best fit"}
          </Button>
        )}
      </div>

      {running && progress ? (
        <div className="mt-4" role="status" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            Checking {Math.min(progress.done + 1, progress.total)} of {progress.total}
            {progress.current ? `: ${progress.current}` : ""}…
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress.total > 0 ? Math.max(4, (progress.done / progress.total) * 100) : 4}%` }}
            />
          </div>
        </div>
      ) : null}

      {!running && stale ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          The cargo or the list of types changed since the last check. Press Check again for fresh suggestions.
        </p>
      ) : null}

      {!running && current ? (
        current.ranked.length === 0 ? (
          <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm">
            None of these {current.checked} types can take any of your cargo. Check the cargo sizes, or look at another
            mode (the tabs below).
          </p>
        ) : (
          <>
            {complete.length === 0 ? (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                No single type takes all of your cargo. These come closest; you can also combine types below.
              </p>
            ) : null}
            <ol className="mt-3 divide-y rounded-md border">
              {shown.map((entry, index) => {
                const best = index === 0 && entry.unloadedPieces === 0
                const inUse = selected.length === 1 && selected[0]?.equipmentTypeId === entry.equipmentTypeId && selected[0]?.quantity === entry.units
                return (
                  <li key={entry.equipmentTypeId} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", best && "bg-primary/5")}>
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        best ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.units} × {entry.name}
                        {best ? (
                          <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Best fit</span>
                        ) : null}
                        {entry.specialist ? (
                          <span
                            className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                            title="Flat rack, open top, roll trailer or similar: meant for oversize cargo"
                          >
                            Special equipment
                          </span>
                        ) : null}
                      </p>
                      <p className={cn("text-xs", entry.unloadedPieces > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                        {entry.reason}
                        {entry.totalCost > 0 ? ` Cost ${formatCost(entry.totalCost)}.` : ""}
                      </p>
                    </div>
                    <div className="hidden w-28 shrink-0 sm:block" title={`Average volume used: ${formatPct(entry.avgVolumePct)}`}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, entry.avgVolumePct)}%` }} />
                      </div>
                      <p className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">{formatPct(entry.avgVolumePct)} full</p>
                    </div>
                    {canEdit ? (
                      inUse ? (
                        <span className="inline-flex w-24 items-center justify-center gap-1 text-xs font-medium text-primary">
                          <Check className="size-3.5" />
                          Selected
                        </span>
                      ) : (
                        <Button type="button" size="sm" variant={best ? "default" : "outline"} className="w-24" onClick={() => onUse(entry.equipmentTypeId, entry.units)}>
                          Use this
                        </Button>
                      )
                    ) : null}
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Checked {current.checked} types.
              {complete.length > shown.length ? ` ${complete.length - shown.length} more also fit everything.` : ""} This is a quick
              comparison; the Calculate step makes the final plan.
            </p>
          </>
        )
      ) : null}
    </section>
  )
}
