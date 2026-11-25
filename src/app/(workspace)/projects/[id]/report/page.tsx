import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { equipmentModeSchema, modeLabel } from "@compass/domain"
import { PlanDiagram } from "@/components/plan-diagram"
import { Button } from "@/components/ui/button"
import { ACTUAL_FLOOR_HELP, AXLE_ESTIMATE_NOTE, CLEARANCE_HELP, EFFECTIVE_FLOOR_HELP, clearanceText, formatClearance } from "@/lib/clearance"
import { formatDate, formatKg, formatM3, formatPct } from "@/lib/format"
import { loadOrder } from "@/lib/plan-export"
import { planFromDb } from "@/lib/plan-from-db"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"
import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"

export const metadata = { title: "Load plan report" }

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const project = await prisma.project.findFirst({
    where: { id, orgId: user.orgId },
    include: {
      plans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          unloaded: { include: { cargoItem: true } },
          instances: {
            include: {
              equipmentType: true,
              placements: { include: { cargoItem: true } },
            },
          },
        },
      },
    },
  })
  if (!project) notFound()

  const latest = project.plans[0]
  const plan = latest ? planFromDb(latest) : null
  const mode = equipmentModeSchema.safeParse(project.mode)
  const generated = (latest?.createdAt ?? new Date()).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
  const etd = project.etd ? formatDate(project.etd.toISOString().slice(0, 10)) : "—"

  const back = (
    <Button asChild variant="outline">
      <Link href={`/projects/${project.id}?step=plan`}>
        <ArrowLeft className="size-4" />
        Back to load plan
      </Link>
    </Button>
  )

  if (!plan || plan.units.length === 0) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <h1 className="text-lg font-semibold">No load plan to print yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">Calculate the plan first, then come back to print it.</p>
        <div className="mt-6 flex justify-center">{back}</div>
      </main>
    )
  }

  const totals = {
    pieces: plan.units.reduce((sum, unit) => sum + unit.pieces, 0),
    kg: plan.units.reduce((sum, unit) => sum + unit.netKg, 0),
    volume: plan.units.reduce((sum, unit) => sum + unit.volumeM3, 0),
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-6 text-sm print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 print:hidden">
        {back}
        <p className="text-muted-foreground">Tip: choose “Save as PDF” in the print dialog to share a file.</p>
        <PrintButton />
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Load plan</p>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {mode.success ? modeLabel(mode.data) : project.mode} · ETD {etd}
            {project.notes ? ` · ${project.notes}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
          <Stat label="Units" value={String(plan.units.length)} />
          <Stat label="Pieces" value={String(totals.pieces)} />
          <Stat label="Net weight" value={formatKg(totals.kg)} />
          <Stat label="Volume" value={formatM3(totals.volume)} />
        </dl>
      </header>
      <p className="mt-2 text-xs text-muted-foreground">
        Calculated {generated} by {user.name ?? "Compass"}. Payload and axle limits are planning defaults, not certified ratings. Sizes and positions are in
        centimetres (cm), weights in kg, volumes in m³, and handling clearance in cm.
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>
          <span className="font-medium">Actual floor utilization:</span> {ACTUAL_FLOOR_HELP}
        </li>
        <li>
          <span className="font-medium">Effective floor utilization:</span> {EFFECTIVE_FLOOR_HELP}
        </li>
        <li>
          <span className="font-medium">Handling allowance (project default {formatClearance(plan.clearanceCm)}):</span> {CLEARANCE_HELP}
        </li>
        <li>{AXLE_ESTIMATE_NOTE}</li>
      </ul>

      <section className="mt-5 overflow-hidden rounded-md border print-avoid-break">
        <table className="sheet-table w-full text-left">
          <thead className="bg-muted/70">
            <tr>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Pieces</th>
              <th className="px-3 py-2">Net weight</th>
              <th className="px-3 py-2">Payload used</th>
              <th className="px-3 py-2">Volume used</th>
              <th className="px-3 py-2" title={ACTUAL_FLOOR_HELP}>
                Actual floor utilization (%)
              </th>
              <th className="px-3 py-2" title={EFFECTIVE_FLOOR_HELP}>
                Effective floor utilization (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.units.map((unit, index) => (
              <tr key={`${unit.equipmentId}-${unit.unitIndex}`}>
                <td className="px-3 py-2 font-medium">
                  {index + 1}. {unit.equipmentName}
                </td>
                <td className="px-3 py-2">{unit.pieces}</td>
                <td className="px-3 py-2">{formatKg(unit.netKg)}</td>
                <td className="px-3 py-2">{formatPct(unit.weightPct)}</td>
                <td className="px-3 py-2">{formatPct(unit.volumePct)}</td>
                <td className="px-3 py-2">{formatPct(unit.floorActualPct)}</td>
                <td className="px-3 py-2">{formatPct(unit.floorEffectivePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {plan.unloaded.length > 0 ? (
        <section className="mt-4 rounded-md border border-destructive/40 p-3 print-avoid-break">
          <h2 className="font-semibold text-destructive">
            {plan.unloaded.length} piece{plan.unloaded.length === 1 ? "" : "s"} not loaded
          </h2>
          <ul className="mt-1 list-disc pl-5">
            {plan.unloaded.map((row, index) => (
              <li key={`${row.cargoId}-${index}`}>
                {row.name}: {row.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.units.map((unit, index) => {
        const rows = loadOrder(unit)
        return (
          <section key={`${unit.equipmentId}-${unit.unitIndex}-detail`} className="print-page-break mt-10 print:mt-0">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-2">
              <h2 className="text-lg font-semibold">
                Unit {index + 1} of {plan.units.length}: {unit.equipmentName}
              </h2>
              <p className="text-muted-foreground">
                {unit.pieces} pieces · {formatKg(unit.netKg)} ({formatPct(unit.weightPct)}) · {formatM3(unit.volumeM3)} (
                {formatPct(unit.volumePct)}) · floor {formatPct(unit.floorActualPct)} actual / {formatPct(unit.floorEffectivePct)} effective
              </p>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2 print:grid-cols-2">
              <figure className="rounded-md border p-2 print-avoid-break">
                <figcaption className="text-xs font-medium text-muted-foreground">Top view</figcaption>
                <PlanDiagram unit={unit} view="top" className="h-auto w-full" />
              </figure>
              <figure className="rounded-md border p-2 print-avoid-break">
                <figcaption className="text-xs font-medium text-muted-foreground">Side view (from the right)</figcaption>
                <PlanDiagram unit={unit} view="side" className="h-auto w-full" />
              </figure>
            </div>
            {unit.axleLoads.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                {unit.axleLoads.map((axle) => (
                  <li key={axle.name} className={axle.kg > axle.maxKg ? "font-medium text-destructive" : undefined}>
                    {axle.name}: {formatKg(axle.kg)} / {formatKg(axle.maxKg)}
                  </li>
                ))}
              </ul>
            ) : null}
            <table className="sheet-table mt-3 w-full text-left">
              <thead className="bg-muted/70">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Cargo</th>
                  <th className="px-2 py-1.5">L × W × H (cm)</th>
                  <th className="px-2 py-1.5">Weight</th>
                  <th className="px-2 py-1.5">From front</th>
                  <th className="px-2 py-1.5">From left</th>
                  <th className="px-2 py-1.5">From floor</th>
                  <th className="px-2 py-1.5">Clearance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, order) => (
                  <tr key={item.id} className="print-avoid-break">
                    <td className="px-2 py-1 font-medium">{order + 1}</td>
                    <td className="px-2 py-1">
                      <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: item.color }} />
                      {item.name}
                    </td>
                    <td className="px-2 py-1">
                      {Math.round(item.lengthCm)} × {Math.round(item.widthCm)} × {Math.round(item.heightCm)}
                    </td>
                    <td className="px-2 py-1">{formatKg(item.weightKg)}</td>
                    <td className="px-2 py-1">{Math.round(item.x)} cm</td>
                    <td className="px-2 py-1">{Math.round(item.y)} cm</td>
                    <td className="px-2 py-1">{Math.round(item.z)} cm</td>
                    <td className="px-2 py-1">{clearanceText(item.clearanceSetting ?? null, plan.clearanceCm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  )
}
