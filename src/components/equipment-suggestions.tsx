"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { EquipmentMode } from "@compass/domain"
import { Check, Plane, RefreshCw, Ship, Sparkles, Truck, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import type { CargoLine } from "@/components/cargo-grid"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { suggestEquipment, type EquipmentSuggestion, type Objective, type SuggestProgress } from "@/lib/equipment-suggest"
import { formatCost, formatPct } from "@/lib/format"
import { runSolver } from "@/lib/run-solver"
import { IconTile, TRANSPORT_ICON, TRANSPORT_TINT } from "@/components/design-system"
import { cn } from "@/lib/utils"

const SHOWN = 5

/** How the shipment can travel. The planner picks one before any equipment is compared. */
export const TRANSPORT_CHOICES: { mode: EquipmentMode; label: string; icon: LucideIcon }[] = [
  { mode: "SEA", label: "Sea", icon: Ship },
  { mode: "AIR", label: "Air", icon: Plane },
  { mode: "ROAD", label: "Land", icon: Truck },
]

function signatureOf(objective: Objective, candidates: EquipmentListItem[], cargo: CargoLine[], minSupportPct: number | null): string {
  return JSON.stringify([
    objective,
    minSupportPct,
    candidates.map((item) => item.id),
    cargo.map((line) => [line.id, line.lengthCm, line.widthCm, line.heightCm, line.weightKg, line.quantity, line.stackable, line.orientation]),
  ])
}

/**
 * "Which equipment is best for my cargo?" The planner first says how the shipment travels (sea,
 * air or land). Compass then runs a quick packing trial of the cargo against every equipment type
 * for that mode and lists the best fits, each with a one-click "Use this".
 */
export function EquipmentSuggestions({
  cargo,
  items,
  mode,
  onModeChange,
  objective,
  minSupportPct = null,
  canEdit,
  selected,
  onUse,
  highlight = false,
  onResults,
}: {
  cargo: CargoLine[]
  /** The whole equipment library; the chosen transport mode decides which types are compared. */
  items: EquipmentListItem[]
  /** The transport mode picked for the comparison, or null while the planner has not chosen yet. */
  mode: EquipmentMode | null
  onModeChange: (mode: EquipmentMode) => void
  objective: Objective
  /** The project's minimum support share, when it has one. */
  minSupportPct?: number | null
  canEdit: boolean
  selected: { equipmentTypeId: string; quantity: number }[]
  onUse: (equipmentTypeId: string, units: number) => void
  /** The current ranking (null while there is none or it is out of date), for the page to mark the best fit elsewhere. */
  onResults?: (ranked: EquipmentSuggestion[] | null) => void
  /** Draw attention to the transport choice (used right after a packing list was imported). */
  highlight?: boolean
}) {
  const [progress, setProgress] = useState<SuggestProgress | null>(null)
  const [results, setResults] = useState<{ signature: string; ranked: EquipmentSuggestion[]; checked: number } | null>(null)
  const cancelled = useRef(false)

  const candidates = useMemo(() => (mode ? items.filter((item) => item.mode === mode) : []), [items, mode])
  const counts = useMemo(() => {
    const byMode = new Map<EquipmentMode, number>()
    for (const item of items) byMode.set(item.mode, (byMode.get(item.mode) ?? 0) + 1)
    return byMode
  }, [items])
  const chosen = TRANSPORT_CHOICES.find((choice) => choice.mode === mode) ?? null

  // The results only describe one exact cargo list and set of types; anything else makes them stale.
  const signature = useMemo(() => signatureOf(objective, candidates, cargo, minSupportPct), [cargo, candidates, objective, minSupportPct])
  const current = results && results.signature === signature ? results : null
  const ranked = current?.ranked ?? null
  useEffect(() => {
    onResults?.(ranked)
  }, [onResults, ranked])
  const stale = Boolean(results) && !current

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  /** Picks the transport mode and compares its equipment types straight away. */
  async function run(target: EquipmentMode) {
    if (cargo.length === 0) {
      toast.error("Add cargo first, then I can find the best equipment for it.")
      return
    }
    onModeChange(target)
    const list = items.filter((item) => item.mode === target)
    cancelled.current = false
    setProgress({ done: 0, total: list.length, current: "" })
    try {
      const ranked = await suggestEquipment({
        cargo,
        candidates: list,
        objective,
        minSupportPct,
        run: (input) => runSolver(input),
        onProgress: (next) => {
          if (!cancelled.current) setProgress(next)
        },
        isCancelled: () => cancelled.current,
      })
      if (cancelled.current) return
      setResults({ signature: signatureOf(objective, list, cargo, minSupportPct), ranked, checked: list.length })
    } catch {
      toast.error("Could not compare the equipment. Try again.")
    } finally {
      if (!cancelled.current) setProgress(null)
    }
  }

  const running = progress !== null
  const complete = current?.ranked.filter((entry) => entry.unloadedPieces === 0) ?? []
  const shown = current ? (complete.length > 0 ? complete : current.ranked).slice(0, SHOWN) : []
  const askForMode = !chosen && !running

  return (
    <section
      className={cn("bg-table-head rounded-[var(--radius-card)] border border-[var(--suggest-border)] p-5 shadow-soft", highlight && askForMode && "border-primary ring-2 ring-primary/25")}
      aria-label="Equipment suggestions"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-[17px] leading-6 font-bold text-[var(--table-head-fg)]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--pastel-lavender-bg)] text-[var(--pastel-lavender-accent)]">
              <Sparkles className="size-[18px]" aria-hidden="true" />
            </span>
            {highlight && askForMode ? "Your cargo is in. How will it travel?" : "Not sure which equipment to pick?"}
          </h2>
          <p className="mt-1.5 text-meta text-[var(--table-head-fg)]/80">
            {chosen
              ? `Compass test-packs your cargo into each of the ${candidates.length} ${chosen.label} types and shows the best fits`
              : "Choose Sea, Air or Land. Compass then test-packs your cargo into every equipment type for it and shows the best fits"}
            {objective === "LOWEST_COST" ? " (lowest total cost first)" : " (standard types first, then fewest units, lowest cost, and the fullest load)"}.
          </p>
        </div>
        {running ? (
          <Button
            type="button"
            variant="outline"
            className="press h-10 rounded-xl text-button"
            onClick={() => {
              cancelled.current = true
              setProgress(null)
            }}
          >
            Stop
          </Button>
        ) : chosen && (current || stale) ? (
          <Button type="button" variant="outline" className="press h-10 rounded-xl text-button" onClick={() => void run(chosen.mode)}>
            <RefreshCw className="size-4" />
            Check again
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="How the shipment travels">
        <span className="text-label text-[var(--table-head-fg)]">Find the best fit by</span>
        {TRANSPORT_CHOICES.map((choice) => {
          const count = counts.get(choice.mode) ?? 0
          const active = choice.mode === mode
          const Icon = choice.icon
          return (
            <Button
              key={choice.mode}
              type="button"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              className={cn(
                "press h-10 rounded-xl px-4 text-button",
                !active && "border-white/70 bg-white/60 text-[var(--table-head-fg)] hover:border-primary hover:bg-white/85 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
              )}
              disabled={running || count === 0}
              title={count === 0 ? `No ${choice.label} equipment in the library` : `Compare the ${count} ${choice.label} equipment types`}
              onClick={() => void run(choice.mode)}
            >
              <Icon className="size-4" />
              {choice.label}
            </Button>
          )
        })}
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
        <p className="mt-3 rounded-xl bg-[var(--pastel-amber-bg)] px-3 py-2 text-meta text-amber-900 dark:text-amber-200">
          The cargo or the list of types changed since the last check. Press Check again for fresh suggestions.
        </p>
      ) : null}

      {cargo.some((line) => line.weightEstimate) ? (
        <p className="mt-3 rounded-xl border border-dashed border-amber-500 bg-[var(--pastel-amber-bg)] px-3 py-2 text-meta text-amber-900 dark:text-amber-200">
          Provisional: {cargo.filter((line) => line.weightEstimate).length} cargo line
          {cargo.filter((line) => line.weightEstimate).length === 1 ? " uses an estimated weight" : "s use estimated weights"}. The suggestion is a guide; the weights are confirmed before a load plan is calculated.
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
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              {shown.map((entry, index) => {
                const best = index === 0 && entry.unloadedPieces === 0
                const inUse = selected.length === 1 && selected[0]?.equipmentTypeId === entry.equipmentTypeId && selected[0]?.quantity === entry.units
                const item = items.find((candidate) => candidate.id === entry.equipmentTypeId)
                return (
                  <li
                    key={entry.equipmentTypeId}
                    className={cn(
                      "relative flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border p-4 shadow-soft transition-[transform,box-shadow,border-color] duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-lift",
                      best ? "border-primary bg-[var(--pastel-mint-bg)]" : "bg-card hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", best ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {best ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Best fit</span> : null}
                        {entry.specialist ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground" title="Flat rack, open top, roll trailer or similar: meant for oversize cargo">
                            Special equipment
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-3">
                      {item ? <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" /> : null}
                      <div className="min-w-0">
                      <p className="text-[16px] leading-5 font-bold break-words">
                        {entry.units} × {entry.name}
                      </p>
                      <p className={cn("mt-1 text-meta", entry.unloadedPieces > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                        {entry.reason}
                        {entry.totalCost > 0 ? ` Cost ${formatCost(entry.totalCost)}.` : ""}
                      </p>
                      </div>
                    </div>
                    <div className="mt-auto" title={`Average volume used: ${formatPct(entry.avgVolumePct)}`}>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Volume used</span>
                        <span className="font-semibold tabular-nums">{formatPct(entry.avgVolumePct)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--step-line)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, entry.avgVolumePct)}%` }} />
                      </div>
                    </div>
                    {canEdit ? (
                      inUse ? (
                        <span className="inline-flex h-9 items-center justify-center gap-1 text-button text-primary">
                          <Check className="size-4" />
                          Selected
                        </span>
                      ) : (
                        <Button type="button" variant={best ? "default" : "outline"} className="press h-9 w-full rounded-xl text-button" onClick={() => onUse(entry.equipmentTypeId, entry.units)}>
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
