"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
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
    <section className="space-y-3" aria-labelledby="remaining-capacity-title">
      <h2 id="remaining-capacity-title" className="text-sm font-semibold" title="What is left around the planned cargo, which stays exactly where it is.">
        Remaining capacity
      </h2>

      {stale ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">Recalculate to see the remaining capacity.</p>
      ) : error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      ) : running || !report ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground" role="status">
          Analysing…
        </p>
      ) : (
        <>
          {/* 1. Compact summary, with anything that makes it unreliable or provisional. */}
          <div className="flex flex-wrap items-center gap-3">
            <Totals report={report} />
            {canEdit && onAddCargo ? (
              <Button type="button" onClick={onAddCargo}>
                <Plus className="size-4" aria-hidden="true" />
                Add More Cargo
              </Button>
            ) : null}
          </div>
          <Findings report={report} />
          {/* 2. The detailed analysis. */}
          <h3 className="pt-2 text-sm font-semibold">Details</h3>
          <UniformResult report={report} />
          {report.units.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Units">
              {report.units.map((unit, index) => (
                <Button key={unit.unitIndex} type="button" size="sm" role="tab" aria-selected={index === selected} variant={index === selected ? "default" : "outline"} onClick={() => setSelected(index)}>
                  Unit {unit.unitIndex + 1}
                </Button>
              ))}
            </div>
          ) : null}
          {report.units[selected] ? (
            <UnitDetail
              plan={plan}
              space={report.units[selected]!}
              addition={report.additional?.units.find((entry) => entry.unitIndex === report.units[selected]!.unitIndex) ?? null}
            />
          ) : null}
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
        <div className="rounded-md border border-red-500/50 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <p className="font-medium">Not validated: the plan breaks {violations.length === 1 ? "a rule" : `${violations.length} rules`}.</p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(violations)].slice(0, 6).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {context.provisional ? (
        <p className="rounded-md border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">Provisional:</span> {context.provisionalReasons.join(" ")}
        </p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
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
  return (
    <dl className="flex flex-wrap gap-2">
      <Figure label="Weight left" value={formatKg(totals.remainingKg)} title="Payload left in all units" />
      <Figure label="Volume left" value={formatM3(totals.theoreticalRemainingM3)} title="Theoretical: inner volume less the cargo's own volume. Not all of it can take cargo." />
      <Figure
        label="Usable space"
        value={formatM3(totals.usableM3)}
        title="Free space with something to stand on (the floor or stackable cargo), at least 10 cm each way. Overlapping spaces counted once."
      />
      {totals.restrictedM3 + totals.otherUnusableM3 > 0.0005 ? (
        <Figure label="Unusable" value={formatM3(totals.restrictedM3 + totals.otherUnusableM3)} title={`Above non-stackable cargo: ${formatM3(totals.restrictedM3)}. Gaps too small or with nothing to stand on: ${formatM3(totals.otherUnusableM3)}.`} />
      ) : null}
      <Figure label="Floor left" value={`${totals.remainingFloorM2.toLocaleString("en-US", { maximumFractionDigits: 2 })} m²`} />
      {extra ? (
        <Figure
          label="More packages fit"
          value={`${extra.searchComplete ? "" : "≥ "}${extra.pieces} (total ${extra.potentialTotalPieces})`}
          title="Identical packages found to fit with the packer around the existing cargo. Not a proven maximum."
          highlight
        />
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
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Unit {space.unitIndex + 1}: {space.equipmentName}
        </h3>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Pair label="Payload used / left" value={`${formatKg(space.usedKg)} / ${formatKg(space.remainingKg)}`} />
        <Pair label="Volume used / left" value={`${formatM3(space.usedM3)} / ${formatM3(space.theoreticalRemainingM3)}`} />
        <Pair label="Usable space" value={formatM3(space.usableM3)} />
        <Pair label="Floor used / left" value={`${space.usedFloorM2} / ${space.remainingFloorM2} m²`} />
        <Pair label="Headroom" value={formatCm(space.headroomCm, unit)} />
        {space.restrictedM3 > 0 ? <Pair label="Above non-stackable cargo" value={formatM3(space.restrictedM3)} /> : null}
        {space.otherUnusableM3 > 0 ? <Pair label="Too small or unsupported" value={formatM3(space.otherUnusableM3)} /> : null}
      </dl>
      {addition && stop ? (
        <p className="text-sm" title={stop.detail}>
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
        <div className="grid gap-3 md:grid-cols-2">
          <figure>
            <PlanDiagram unit={view} view="top" proposed={proposed} className="h-auto w-full" />
            <figcaption className="text-xs text-muted-foreground">Top</figcaption>
          </figure>
          <figure>
            <PlanDiagram unit={view} view="side" proposed={proposed} className="h-auto w-full" />
            <figcaption className="text-xs text-muted-foreground">
              Side{proposed.length > 0 ? " · dashed: more packages" : ""}
            </figcaption>
          </figure>
        </div>
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
    <details className="group space-y-1">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">
        Loading spaces ({space.regions.length}{space.restrictedRegions.length > 0 ? ` + ${space.restrictedRegions.length} restricted` : ""})
      </summary>
      <div className="mt-1 overflow-x-auto rounded-md border">
        <table className="sheet-table w-full text-left text-sm">
          <thead className="bg-muted/70 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Size (L × W × H)</th>
              <th className="px-3 py-1.5" title="From the front, the left wall and the floor">Position</th>
              <th className="px-3 py-1.5">Volume</th>
              <th className="px-3 py-1.5">Stands on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((region, index) => (
              <tr key={index} className={cn(region.base === "non-stackable-cargo" && "text-muted-foreground")}>
                <td className="px-3 py-1.5 tabular-nums">{formatEnvelope(region.lengthCm, region.widthCm, region.heightCm, unit)}</td>
                <td className="px-3 py-1.5 tabular-nums">{[region.x, region.y, region.z].map((value) => formatCm(value, unit)).join(", ")}</td>
                <td className="px-3 py-1.5 tabular-nums">{formatM3(region.volumeM3)}</td>
                <td className="px-3 py-1.5">{region.base === "non-stackable-cargo" ? `${BASE_LABEL[region.base]} (restricted)` : BASE_LABEL[region.base]}</td>
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

function Figure({ label, value, title, highlight = false }: { label: string; value: string; title?: string; highlight?: boolean }) {
  return (
    <div className={cn("min-w-28 rounded-lg border bg-card px-3 py-2 shadow-card", highlight && "border-primary/50")} title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
