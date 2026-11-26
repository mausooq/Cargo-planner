"use client"

import { useState } from "react"
import { Ban, Boxes, ChevronRight, Gauge as GaugeIcon, Grid2x2, PackageCheck, PackageOpen, PackagePlus, Plus, Scale } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import { IconTile } from "@/components/design-system"
import type { SpaceRegion, UnitAddition, UnitSpace } from "@compass/solver"
import type { CargoLine } from "@/components/cargo-grid"
import { PlanDiagram } from "@/components/plan-diagram"
import { useRemainingCapacity } from "@/components/use-remaining-capacity"
import { Button } from "@/components/ui/button"
import { formatCm, formatEnvelope, formatKg, formatM3 } from "@/lib/format"
import { useLengthUnit } from "@/lib/length-unit-pref"
import type { PlanView } from "@/lib/plan-view"
import { describeStop, type RemainingCapacityReport } from "@/lib/remaining-capacity"
import { cn } from "@/lib/utils"

const SHOWN_REGIONS = 8

const BASE_LABEL: Record<SpaceRegion["base"], string> = {
  floor: "Floor",
  "stackable-cargo": "On stackable cargo",
  "non-stackable-cargo": "Above non-stackable cargo",
}

/**
 * Remaining Capacity Analysis for a calculated (or hand-arranged) plan: what is left in each unit, how much of it
 * can really take cargo, and, when every loaded package is the same, how many more of it were found to fit.
 * Self-contained: give it the plan and the cargo; it saves nothing.
 */
export function RemainingCapacityPanel({
  plan,
  cargo,
  minSupportPct,
  canEdit,
  stale,
  onAddCargo,
}: {
  plan: PlanView
  cargo: CargoLine[]
  minSupportPct: number | null
  canEdit: boolean
  /** The plan no longer matches the cargo: nothing is analysed until it is recalculated. */
  stale: boolean
  /** Opens the project's Cargo step, where more cargo is added with the usual cargo tools. */
  onAddCargo?: () => void
}) {
  const { report, error, running } = useRemainingCapacity(plan, cargo, minSupportPct, !stale)
  const [selected, setSelected] = useState(0)

  return (
    <section className="bg-table-head space-y-4 rounded-[var(--radius-card)] border border-[var(--suggest-border)] p-5 shadow-soft" aria-labelledby="remaining-capacity-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <IconTile icon={GaugeIcon} tint="lavender" size="md" />
          <div className="min-w-0">
            <h2 id="remaining-capacity-title" className="text-[20px] leading-7 font-bold text-[var(--table-head-fg)]">
              Remaining capacity analysis
            </h2>
            <p className="text-meta text-[var(--table-head-fg)]/80">What is still free around the planned cargo, which stays exactly where it is.</p>
          </div>
        </div>
        {canEdit && onAddCargo ? (
          <Button type="button" className="press h-11 rounded-xl px-5 text-button shadow-soft" onClick={onAddCargo}>
            <Plus className="size-4" aria-hidden="true" />
            Add More Cargo
          </Button>
        ) : null}
      </div>

      {stale ? (
        <p className="rounded-xl bg-white/70 px-4 py-3 text-detail dark:bg-white/5">Recalculate to see the remaining capacity.</p>
      ) : error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      ) : running || !report ? (
        <p className="rounded-xl bg-white/70 px-4 py-3 text-detail text-muted-foreground dark:bg-white/5" role="status">
          Analysing…
        </p>
      ) : (
        <>
          {/* 1. Compact summary, with anything that makes it unreliable or provisional. */}
          <Totals report={report} />
          <Findings report={report} />
          {/* 2. The detailed analysis, on a white panel. */}
          <div className="surface-card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[17px] leading-6 font-bold">Detailed capacity</h3>
                <UniformResult report={report} />
              </div>
              {report.units.length > 1 ? (
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Units">
                  {report.units.map((unit, index) => (
                    <button
                      key={unit.unitIndex}
                      type="button"
                      role="tab"
                      aria-selected={index === selected}
                      onClick={() => setSelected(index)}
                      className={cn(
                        "press h-8 rounded-full border px-3 text-[13px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                        index === selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50",
                      )}
                    >
                      Unit {unit.unitIndex + 1}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {report.units[selected] ? (
              <UnitDetail
                plan={plan}
                space={report.units[selected]!}
                addition={report.additional?.units.find((entry) => entry.unitIndex === report.units[selected]!.unitIndex) ?? null}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

/** Problems with the plan itself and reasons the figures are provisional. */
function Findings({ report }: { report: RemainingCapacityReport }) {
  const { context } = report
  const violations = [...report.violations.map((entry) => entry.message), ...context.layoutProblems.map((entry) => `Unit ${entry.unitIndex + 1}: ${entry.message}`)]
  const notes: string[] = []
  if (context.stackingNotStated.length > 0) {
    notes.push(`Stacking not stated for ${context.stackingNotStated.join(", ")}: treated as not stackable.`)
  }
  if (context.unloadedPieces > 0) notes.push(`${context.unloadedPieces} piece${context.unloadedPieces === 1 ? " is" : "s are"} not loaded in this plan.`)
  if (context.excludedLines.length > 0) notes.push(`${context.excludedLines.length} incomplete cargo line${context.excludedLines.length === 1 ? " is" : "s are"} not in the plan.`)
  for (const note of report.notes) notes.push(note.message)
  if (violations.length === 0 && !context.provisional && notes.length === 0) return null
  return (
    <div className="space-y-2">
      {violations.length > 0 ? (
        <div className="rounded-xl border border-red-500/50 bg-red-50 px-4 py-3 text-detail text-red-900 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <p className="font-medium">Not validated: the plan breaks {violations.length === 1 ? "a rule" : `${violations.length} rules`}.</p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(violations)].slice(0, 6).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {context.provisional ? (
        <p className="pastel-amber rounded-xl border border-dashed border-amber-500 bg-[var(--pc-bg)] px-4 py-3 text-detail text-amber-900 dark:text-amber-200">
          <span className="font-medium">Provisional:</span> {context.provisionalReasons.join(" ")}
        </p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-meta text-[var(--table-head-fg)]/85">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Totals({ report }: { report: RemainingCapacityReport }) {
  const { totals } = report
  const extra = report.additional
  const unusable = totals.restrictedM3 + totals.otherUnusableM3
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <Figure icon={Scale} tone="lavender" label="Remaining payload" value={formatKg(totals.remainingKg)} hint="Weight left in all units" />
      <Figure icon={Boxes} tone="blue" label="Remaining volume" value={formatM3(totals.theoreticalRemainingM3)} hint="Theoretical: not all of it can take cargo" />
      <Figure icon={PackageOpen} tone="mint" label="Usable loading space" value={formatM3(totals.usableM3)} hint="Free space with something to stand on" title="Free space with something to stand on (the floor or stackable cargo), at least 10 cm each way. Overlapping spaces counted once." />
      <Figure icon={Grid2x2} tone="mint" label="Remaining floor area" value={`${totals.remainingFloorM2.toLocaleString("en-US", { maximumFractionDigits: 2 })} m²`} hint="Floor not covered by cargo" />
      {unusable > 0.0005 ? (
        <Figure
          icon={Ban}
          tone="amber"
          label="Restricted or unusable"
          value={formatM3(unusable)}
          hint={totals.restrictedM3 > 0 ? `${formatM3(totals.restrictedM3)} above non-stackable cargo` : "Gaps too small or unsupported"}
          title={`Above non-stackable cargo: ${formatM3(totals.restrictedM3)}. Gaps too small or with nothing to stand on: ${formatM3(totals.otherUnusableM3)}.`}
        />
      ) : null}
      {extra ? (
        <>
          <Figure
            icon={PackagePlus}
            tone="mint"
            label="Additional identical packages"
            value={`${extra.searchComplete ? "" : "≥ "}${extra.pieces}`}
            hint="Found by the packer; not a guaranteed maximum"
            title="Identical packages found to fit with the packer around the existing cargo. The packer is a heuristic, so this is the count it found, not a proven maximum."
            highlight
          />
          <Figure icon={PackageCheck} tone="blue" label="Potential total packages" value={String(extra.potentialTotalPieces)} hint="Loaded now plus those found" />
        </>
      ) : null}
    </dl>
  )
}

function UniformResult({ report }: { report: RemainingCapacityReport }) {
  const { uniform, additional } = report
  const unit = useLengthUnit()
  if (!uniform.uniform || !additional) {
    return uniform.uniform ? null : (
      <p className="text-sm text-muted-foreground" title={uniform.reason}>
        Mixed packages: no package count.
      </p>
    )
  }
  const t = uniform.template
  return (
    <p
      className="text-sm text-muted-foreground"
      title={`Found by the packer with every placement rule; not a proven maximum.${uniform.weightsDiffer ? ` Weights differ; the heaviest (${formatKg(t.weightKg)}) is used.` : ""}`}
    >
      Package {formatEnvelope(t.lengthCm, t.widthCm, t.heightCm, unit)}, {t.stackable ? "stackable" : "not stackable"}
      {t.bottomOnly ? ", floor only" : ""}
      {additional.pieces > 0 ? ` · +${formatKg(additional.weightKg)}, +${formatM3(additional.volumeM3)}` : ""}
    </p>
  )
}

function UnitDetail({
  plan,
  space,
  addition,
}: {
  plan: PlanView
  space: UnitSpace
  addition: UnitAddition | null
}) {
  const unit = useLengthUnit()
  const view = plan.units.find((entry) => entry.unitIndex === space.unitIndex)
  const proposed = addition?.placements ?? []
  const stop = addition ? describeStop(addition.stop) : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-bold">
          Unit {space.unitIndex + 1}: {space.equipmentName}
        </h4>
      </div>
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--table-border)] bg-card text-detail sm:grid-cols-4">
        <Pair label="Payload used / left" value={`${formatKg(space.usedKg)} / ${formatKg(space.remainingKg)}`} />
        <Pair label="Volume used / left" value={`${formatM3(space.usedM3)} / ${formatM3(space.theoreticalRemainingM3)}`} />
        <Pair label="Usable space" value={formatM3(space.usableM3)} />
        <Pair label="Floor used / left" value={`${space.usedFloorM2} / ${space.remainingFloorM2} m²`} />
        <Pair label="Headroom" value={formatCm(space.headroomCm, unit)} />
        {space.restrictedM3 > 0 ? <Pair label="Above non-stackable cargo" value={formatM3(space.restrictedM3)} /> : null}
        {space.otherUnusableM3 > 0 ? <Pair label="Too small or unsupported" value={formatM3(space.otherUnusableM3)} /> : null}
      </dl>
      {addition && stop ? (
        <p className="text-detail" title={stop.detail}>
          {addition.pieces > 0 ? `+${addition.pieces} here` : "No more here"} · {stop.physical ? "limited by" : "stopped by"} {stop.label.toLowerCase()}
          {!stop.physical ? " (more may fit)" : ""}
        </p>
      ) : null}
      {addition?.newWarnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-800 dark:text-amber-300">
          {warning}.
        </p>
      ))}
      {view ? (
        <>
          <Legend proposed={proposed.length > 0} />
          <div className="grid gap-4 md:grid-cols-2">
            <figure className="rounded-xl border border-[var(--table-border)] bg-white p-2 dark:bg-muted/30">
              <PlanDiagram unit={view} view="top" proposed={proposed} className="mx-auto h-auto max-h-72 w-full" />
              <figcaption className="px-1 text-xs font-semibold text-muted-foreground">Top view</figcaption>
            </figure>
            <figure className="rounded-xl border border-[var(--table-border)] bg-white p-2 dark:bg-muted/30">
              <PlanDiagram unit={view} view="side" proposed={proposed} className="mx-auto h-auto max-h-72 w-full" />
              <figcaption className="px-1 text-xs font-semibold text-muted-foreground">Side view</figcaption>
            </figure>
          </div>
        </>
      ) : null}
      <RegionTable space={space} />
    </div>
  )
}

function RegionTable({ space }: { space: UnitSpace }) {
  const unit = useLengthUnit()
  const rows = [...space.regions.slice(0, SHOWN_REGIONS), ...space.restrictedRegions.slice(0, 3)]
  const hidden = space.regions.length - Math.min(space.regions.length, SHOWN_REGIONS)
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No free loading space is left in this unit.</p>
  return (
    <details className="group space-y-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1 text-[15px] font-bold select-none hover:text-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform duration-200 group-open:rotate-90" aria-hidden="true" />
        Available loading spaces ({space.regions.length}{space.restrictedRegions.length > 0 ? ` + ${space.restrictedRegions.length} restricted` : ""})
      </summary>
      <div className="overflow-x-auto rounded-xl border border-[var(--table-border)]">
        <table className="data-table w-full text-left text-sm">
          <thead>
            <tr>
              <th className="px-4">Size (L × W × H)</th>
              <th className="px-4" title="From the front, the left wall and the floor">
                Position (front, left, floor)
              </th>
              <th className="px-4 text-right">Volume</th>
              <th className="px-4">Stands on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((region, index) => (
              <tr key={index} className={cn("border-t", region.base === "non-stackable-cargo" && "text-muted-foreground")}>
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{formatEnvelope(region.lengthCm, region.widthCm, region.heightCm, unit)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{[region.x, region.y, region.z].map((value) => formatCm(value, unit)).join(", ")}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatM3(region.volumeM3)}</td>
                <td className="px-4 py-2.5">{region.base === "non-stackable-cargo" ? `${BASE_LABEL[region.base]} (restricted)` : BASE_LABEL[region.base]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? <p className="text-xs text-muted-foreground">+{hidden} smaller</p> : null}
      {space.regionsTruncated ? <p className="text-xs text-muted-foreground">Largest spaces only; usable space may be a little larger.</p> : null}
      {space.contoured ? <p className="text-xs text-muted-foreground">Contoured unit: spaces may reach into cut-off corners.</p> : null}
    </details>
  )
}

const FIGURE_TONE = {
  mint: "text-[var(--pastel-mint-accent)] bg-[var(--pastel-mint-bg)]",
  lavender: "text-[var(--pastel-lavender-accent)] bg-[var(--pastel-lavender-bg)]",
  blue: "text-[var(--pastel-blue-accent)] bg-[var(--pastel-blue-bg)]",
  amber: "text-[var(--pastel-amber-accent)] bg-[var(--pastel-amber-bg)]",
} as const

function Figure({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  title,
  highlight = false,
}: {
  icon: ComponentType<{ className?: string }>
  tone: keyof typeof FIGURE_TONE
  label: string
  value: string
  hint?: ReactNode
  title?: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border border-white/80 bg-white/80 p-3.5 shadow-soft transition-[transform,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-lift dark:border-white/10 dark:bg-white/5",
        highlight && "border-primary/50 ring-1 ring-primary/20",
      )}
      title={title}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", FIGURE_TONE[tone])}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
        <dd className="text-[20px] leading-7 font-extrabold tabular-nums">{value}</dd>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

/** What the diagram colours mean. Proposed pieces are only proposals: they are not in the plan. */
function Legend({ proposed }: { proposed: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-meta" aria-label="Diagram legend">
      <li className="flex items-center gap-2">
        <span className="size-3.5 rounded-sm bg-primary/80 ring-1 ring-slate-900/40" aria-hidden="true" />
        Loaded cargo
      </li>
      {proposed ? (
        <li className="flex items-center gap-2">
          <span className="size-3.5 rounded-sm border-2 border-dashed border-sky-600 bg-sky-500/15" aria-hidden="true" />
          Proposed additional packages (not loaded)
        </li>
      ) : null}
      <li className="flex items-center gap-2">
        <span className="size-3.5 rounded-sm border border-slate-500 bg-slate-50" aria-hidden="true" />
        Empty space
      </li>
    </ul>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-b border-[var(--table-border)] px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
