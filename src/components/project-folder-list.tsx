"use client"

import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Container,
  Copy,
  Layers,
  LayoutGrid,
  List,
  Package,
  Pencil,
  PlaneTakeoff,
  Search,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, type ComponentType } from "react"
import { toast } from "sonner"
import { equipmentModeSchema, modeLabel, type EquipmentMode } from "@compass/domain"
import { duplicateProject, removeEquipmentFromProject } from "@/app/actions/projects"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DeleteProjectButton } from "@/components/delete-project-button"
import { FilterChip, FOCUS_RING, ICON_ACTION, IconTile, pillClass, Segmented, StatCard, StepProgress, TRANSPORT_ICON, TRANSPORT_TINT, type PillTone, type StepState, type Tint } from "@/components/design-system"
import { ProjectEditDialog } from "@/components/project-edit-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectMenu } from "@/components/ui/select-menu"
import { MODE_ORDER } from "@/lib/equipment-catalog"
import { formatDate, formatKg, formatM3 } from "@/lib/format"
import { daysUntil, relativeDays, stepsDone, type ProjectStatus } from "@/lib/project-status"
import { cn } from "@/lib/utils"

export type ProjectFolder = {
  id: string
  name: string
  mode: string
  etd: string | null
  notes: string | null
  cargoCount: number
  pieces: number
  /** Total cargo weight of the lines that have one, in kg. */
  weightKg: number
  /** Total cargo volume, in m³. */
  volumeM3: number
  /** Cargo lines with no weight yet. */
  unweighedLines: number
  updatedAt: string
  status: ProjectStatus
  containers: { equipmentTypeId: string; name: string; mode: string; quantity: number }[]
}

type SortKey = "recent" | "etd" | "name"
type Scope = "all" | "attention" | "planned" | "soon"
type View = "cards" | "list"

const STATUS_TONE: Record<ProjectStatus["tone"], PillTone> = { neutral: "neutral", action: "info", warning: "warning", success: "success" }

const MODE_ICON = TRANSPORT_ICON
const MODE_TINT = TRANSPORT_TINT
const STEP_NAMES = ["Cargo", "Equipment", "Calculate", "Load Plan"]

function parseMode(mode: string): EquipmentMode {
  const parsed = equipmentModeSchema.safeParse(mode)
  return parsed.success ? parsed.data : "SEA"
}

const needsAttention = (project: ProjectFolder) => project.status.tone === "action" || project.status.tone === "warning"
const departsSoon = (project: ProjectFolder) => {
  const days = project.etd ? daysUntil(project.etd) : null
  return days !== null && days >= 0 && days <= 7
}

/** The four workflow steps as the project's real status has them. */
function workflowSteps(status: ProjectStatus): { name: string; state: StepState; hint?: string }[] {
  const done = stepsDone(status.kind)
  const attention = status.tone === "warning"
  return STEP_NAMES.map((name, index) => {
    if (index < done) return { name, state: "done", hint: "done" }
    if (index === done) {
      const hint = status.kind === "stale" ? "out of date, recalculate" : status.label.toLowerCase()
      return { name, state: attention ? "attention" : "current", hint }
    }
    return { name, state: "pending" }
  })
}

function cargoLines(project: ProjectFolder): { main: string; detail: string | null } | null {
  if (project.pieces === 0) return null
  const main = `${project.pieces} piece${project.pieces === 1 ? "" : "s"} · ${formatM3(project.volumeM3)}`
  if (project.unweighedLines === project.cargoCount) return { main, detail: "Weight not entered" }
  const missing = project.unweighedLines > 0 ? ` · ${project.unweighedLines} without weight` : ""
  return { main, detail: `${formatKg(project.weightKg)}${missing}` }
}

export function ProjectFolderList({
  projects,
  canEdit,
  canDelete,
}: {
  projects: ProjectFolder[]
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<EquipmentMode | "ALL">("ALL")
  const [scope, setScope] = useState<Scope>("all")
  const [sort, setSort] = useState<SortKey>("recent")
  const [view, setView] = useState<View>("cards")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ projectId: string; equipmentTypeId: string; name: string } | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)

  const modesInUse = MODE_ORDER.filter((entry) => projects.some((project) => project.mode === entry))
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = projects.filter((project) => {
      if (mode !== "ALL" && project.mode !== mode) return false
      if (scope === "attention" && !needsAttention(project)) return false
      if (scope === "planned" && project.status.kind !== "planned") return false
      if (scope === "soon" && !departsSoon(project)) return false
      if (!needle) return true
      return [project.name, project.notes ?? "", ...project.containers.map((item) => item.name)]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name)
      if (sort === "etd") return (a.etd ?? "9999").localeCompare(b.etd ?? "9999")
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [mode, projects, query, scope, sort])

  const editing = projects.find((project) => project.id === editingId) ?? null

  async function duplicate(project: ProjectFolder) {
    setDuplicating(project.id)
    const result = await duplicateProject(project.id)
    setDuplicating(null)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Created “${result.name}”.`, {
      action: { label: "Open", onClick: () => router.push(`/projects/${result.id}`) },
    })
    router.refresh()
  }

  const tiles: { id: Scope; label: string; value: number; icon: ComponentType<{ className?: string }>; tint: Tint; hint: string }[] = [
    { id: "all", label: "All Projects", value: projects.length, icon: Layers, tint: "mint", hint: "Every shipment" },
    { id: "attention", label: "Need Attention", value: projects.filter(needsAttention).length, icon: AlertTriangle, tint: "amber", hint: "A step is waiting for you" },
    { id: "planned", label: "Planned", value: projects.filter((project) => project.status.kind === "planned").length, icon: CheckCircle2, tint: "mint", hint: "Load plan is ready" },
    { id: "soon", label: "Departing in 7 Days", value: projects.filter(departsSoon).length, icon: CalendarClock, tint: "blue", hint: "ETD this week" },
  ]

  /** Everything a card or a list row shows and does for one project. */
  function partsOf(project: ProjectFolder) {
    const projectMode = parseMode(project.mode)
    const etdHint = project.etd ? relativeDays(project.etd) : ""
    const past = etdHint.endsWith("ago") || etdHint === "yesterday"
    const href = `/projects/${project.id}?step=${project.status.step}`
    const steps = workflowSteps(project.status)
    const done = stepsDone(project.status.kind)
    const progressLabel = `${done} of 4 steps done${done < 4 ? `; next: ${STEP_NAMES[done]}` : ""}`
    const subtitle = (
      <>
        {modeLabel(projectMode)} ·{" "}
        {project.etd ? (
          <span className={cn(past && "text-amber-700 dark:text-amber-400")} suppressHydrationWarning>
            ETD {formatDate(project.etd)}
            {etdHint ? ` (${etdHint})` : ""}
          </span>
        ) : (
          "ETD missing"
        )}
      </>
    )
    const status = (
      <Link href={href} className={pillClass(STATUS_TONE[project.status.tone], cn("press hover:brightness-95 dark:hover:brightness-110", FOCUS_RING))} title="Open the step that needs attention">
        {project.status.label}
      </Link>
    )
    const equipment =
      project.containers.length === 0 ? (
        <span className="text-muted-foreground">Not selected</span>
      ) : (
        <span className="flex flex-col">
          {project.containers.map((item) => (
            <span key={item.equipmentTypeId} className="group/unit inline-flex max-w-full items-center gap-1">
              <span className="tabular-nums">
                {item.quantity} × {item.name}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="rounded text-muted-foreground opacity-60 group-hover/unit:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  aria-label={`Remove ${item.name} from ${project.name}`}
                  title={`Remove ${item.name}`}
                  onClick={() => setRemoving({ projectId: project.id, equipmentTypeId: item.equipmentTypeId, name: item.name })}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </span>
      )
    const cargo = cargoLines(project)
    const actions = (
      <>
        {canEdit ? (
          <>
            <Button type="button" size="icon" variant="ghost" className={ICON_ACTION} aria-label={`Edit ${project.name}`} title="Edit details" onClick={() => setEditingId(project.id)}>
              <Pencil />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={ICON_ACTION}
              aria-label={`Duplicate ${project.name}`}
              title="Duplicate (copies cargo and equipment)"
              disabled={duplicating === project.id}
              onClick={() => void duplicate(project)}
            >
              <Copy />
            </Button>
          </>
        ) : null}
        {canDelete ? <DeleteProjectButton projectId={project.id} name={project.name} label="" /> : null}
      </>
    )
    const open = (
      <Button asChild className={cn("press h-10 rounded-xl px-5 text-button shadow-soft hover:shadow-lift [&_svg]:transition-transform hover:[&_svg]:translate-x-0.5", FOCUS_RING)}>
        <Link href={href}>
          Open
          <ArrowRight />
        </Link>
      </Button>
    )
    return { projectMode, href, steps, progressLabel, subtitle, status, equipment, cargo, actions, open }
  }

  return (
    <div className="space-y-7">
      {/* Summary cards double as filters. */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Filter projects">
        {tiles.map((tile) => (
          <StatCard
            key={tile.id}
            icon={tile.icon}
            tint={tile.tint}
            value={tile.value}
            label={tile.label}
            hint={tile.hint}
            selected={scope === tile.id}
            onClick={() => setScope(scope === tile.id ? "all" : tile.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80 lg:w-96">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or equipment…"
            aria-label="Search projects"
            className="h-11 rounded-xl bg-card pl-10 text-[15px] shadow-soft transition-[border-color,box-shadow] duration-200 hover:border-primary/40"
          />
        </div>
        {modesInUse.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by mode">
            {(["ALL", ...modesInUse] as const).map((entry) => (
              <FilterChip key={entry} active={mode === entry} onClick={() => setMode(entry)}>
                {entry === "ALL" ? "All" : modeLabel(entry)}
              </FilterChip>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Cards", icon: LayoutGrid },
              { value: "list", label: "List", icon: List },
            ]}
          />
          <div className="flex items-center gap-2.5">
            <span className="text-meta text-muted-foreground" aria-hidden="true">
              Sort by
            </span>
            <SelectMenu
              label="Sort projects"
              value={sort}
              onChange={setSort}
              className="w-56"
              options={[
                { value: "recent", label: "Recently changed", icon: Clock3 },
                { value: "etd", label: "Departure (soonest)", icon: PlaneTakeoff },
                { value: "name", label: "Name (A–Z)", icon: ArrowDownAZ },
              ]}
            />
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed bg-card px-4 py-12 text-center text-detail text-muted-foreground">
          No projects match.{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setQuery("")
              setMode("ALL")
              setScope("all")
            }}
          >
            Clear filters
          </button>
        </div>
      ) : view === "cards" ? (
        <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const part = partsOf(project)
            return (
              <li key={project.id} className="surface-card lift flex h-full min-w-0 flex-col">
                <div className="flex items-start gap-3.5 p-6 pb-5">
                  <IconTile icon={MODE_ICON[part.projectMode]} tint={MODE_TINT[part.projectMode]} title={modeLabel(part.projectMode)} />
                  <span className="h-12 w-px shrink-0 self-center bg-border" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Link href={part.href} className={cn("line-clamp-2 rounded-sm text-card-title break-words hover:text-primary", FOCUS_RING)}>
                      {project.name}
                    </Link>
                    <p className="mt-1 text-meta text-muted-foreground">{part.subtitle}</p>
                  </div>
                  {part.status}
                </div>

                <div className="mx-6 grid gap-3 border-t py-5 min-[420px]:grid-cols-2 min-[420px]:gap-0">
                  <div className="flex min-w-0 gap-3 pr-3">
                    <IconTile icon={Package} tint="mint" size="sm" />
                    <div className="min-w-0">
                      <p className="text-label">Cargo</p>
                      {part.cargo ? (
                        <>
                          <p className="text-detail text-muted-foreground tabular-nums">{part.cargo.main}</p>
                          <p className="text-detail text-muted-foreground tabular-nums">{part.cargo.detail}</p>
                        </>
                      ) : (
                        <p className="text-detail text-muted-foreground">No cargo yet</p>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-0 gap-3 min-[420px]:border-l min-[420px]:pl-4">
                    <IconTile icon={Container} tint="mint" size="sm" />
                    <div className="min-w-0">
                      <p className="text-label">Equipment</p>
                      <div className="text-detail text-muted-foreground">{part.equipment}</div>
                    </div>
                  </div>
                </div>

                <div className="mx-6 border-t py-5">
                  <StepProgress steps={part.steps} label={part.progressLabel} />
                </div>

                <div className="mx-6 mt-auto flex items-center gap-1 border-t py-4">
                  {part.actions}
                  <span className="ml-auto">{part.open}</span>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className="space-y-3">
          {visible.map((project) => {
            const part = partsOf(project)
            return (
              <li
                key={project.id}
                className="surface-card lift grid min-w-0 items-center gap-x-5 gap-y-3 px-5 py-4 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(12rem,1.4fr)_auto]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <IconTile icon={MODE_ICON[part.projectMode]} tint={MODE_TINT[part.projectMode]} size="sm" title={modeLabel(part.projectMode)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link href={part.href} className={cn("line-clamp-2 rounded-sm text-[17px] leading-6 font-bold break-words hover:text-primary", FOCUS_RING)}>
                        {project.name}
                      </Link>
                    </div>
                    <p className="text-meta text-muted-foreground">{part.subtitle}</p>
                  </div>
                  {part.status}
                </div>
                <div className="min-w-0 text-detail tabular-nums">
                  <p className="text-label text-muted-foreground">Cargo</p>
                  {part.cargo ? (
                    <p>
                      {part.cargo.main}
                      <span className="text-muted-foreground"> · {part.cargo.detail}</span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">No cargo yet</p>
                  )}
                </div>
                <div className="min-w-0 text-detail">
                  <p className="text-label text-muted-foreground">Equipment</p>
                  {part.equipment}
                </div>
                <div className="hidden xl:block">
                  <StepProgress steps={part.steps} compact label={part.progressLabel} />
                </div>
                <div className="flex items-center gap-1 md:col-span-3 md:justify-end xl:col-span-1">
                  {part.actions}
                  <span className="ml-2">{part.open}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing ? (
        <ProjectEditDialog
          project={editing}
          open
          onOpenChange={(next) => {
            if (!next) setEditingId(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? "this unit"}?`}
        description="It is taken out of this project's equipment. The current load plan stays until you recalculate."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return
          const result = await removeEquipmentFromProject(removing.projectId, removing.equipmentTypeId)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`Removed ${removing.name}.`)
          router.refresh()
        }}
      />
    </div>
  )
}
