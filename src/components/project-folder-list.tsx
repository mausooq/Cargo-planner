"use client"

import { AlertTriangle, ArrowRight, Box, CalendarClock, CheckCircle2, Copy, FolderOpen, Pencil, Plane, Search, Ship, Truck, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { equipmentModeSchema, modeLabel, type EquipmentMode } from "@compass/domain"
import { duplicateProject, removeEquipmentFromProject } from "@/app/actions/projects"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DeleteProjectButton } from "@/components/delete-project-button"
import { ProjectEditDialog } from "@/components/project-edit-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MODE_ORDER } from "@/lib/equipment-catalog"
import { formatDate } from "@/lib/format"
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
  updatedAt: string
  status: ProjectStatus
  containers: { equipmentTypeId: string; name: string; mode: string; quantity: number }[]
}

type SortKey = "recent" | "etd" | "name"
type Scope = "all" | "attention" | "planned" | "soon"

const TONE: Record<ProjectStatus["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  action: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
}

const MODE_ICON: Record<EquipmentMode, typeof Ship> = { SEA: Ship, AIR: Plane, ROAD: Truck, PALLET: Box }
const MODE_TINT: Record<EquipmentMode, string> = {
  SEA: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  AIR: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  ROAD: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  PALLET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
}
const STEP_NAMES = ["Cargo", "Equipment", "Calculate", "Load plan"]

function parseMode(mode: string): EquipmentMode {
  const parsed = equipmentModeSchema.safeParse(mode)
  return parsed.success ? parsed.data : "SEA"
}

const needsAttention = (project: ProjectFolder) => project.status.tone === "action" || project.status.tone === "warning"
const departsSoon = (project: ProjectFolder) => {
  const days = project.etd ? daysUntil(project.etd) : null
  return days !== null && days >= 0 && days <= 7
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

  const tiles: { id: Scope; label: string; value: number; icon: typeof Ship; tint: string; hint: string }[] = [
    { id: "all", label: "All projects", value: projects.length, icon: FolderOpen, tint: "bg-primary/10 text-primary", hint: "Every shipment" },
    {
      id: "attention",
      label: "Need attention",
      value: projects.filter(needsAttention).length,
      icon: AlertTriangle,
      tint: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      hint: "A step is waiting for you",
    },
    {
      id: "planned",
      label: "Planned",
      value: projects.filter((project) => project.status.kind === "planned").length,
      icon: CheckCircle2,
      tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      hint: "Load plan is ready",
    },
    {
      id: "soon",
      label: "Departing in 7 days",
      value: projects.filter(departsSoon).length,
      icon: CalendarClock,
      tint: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
      hint: "ETD this week",
    },
  ]

  return (
    <div className="space-y-5">
      {/* Summary tiles double as filters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Filter projects">
        {tiles.map((tile) => {
          const Icon = tile.icon
          const active = scope === tile.id
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={active}
              onClick={() => setScope(active ? "all" : tile.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-4 text-left hover:border-primary/40",
                active && "border-primary ring-2 ring-primary/20",
              )}
            >
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tile.tint)}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl leading-none font-semibold tabular-nums" suppressHydrationWarning>
                  {tile.value}
                </span>
                <span className="mt-1 block truncate text-sm font-medium">{tile.label}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{tile.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or equipment"
            aria-label="Search projects"
            className="bg-card pl-9"
          />
        </div>
        {modesInUse.length > 1 ? (
          <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Filter by mode">
            {(["ALL", ...modesInUse] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={mode === entry}
                onClick={() => setMode(entry)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium",
                  mode === entry ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry === "ALL" ? "All" : modeLabel(entry)}
              </button>
            ))}
          </div>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort</span>
          <select
            className="h-9 rounded-md border bg-card px-2 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            <option value="recent">Recently changed</option>
            <option value="etd">Departure (soonest)</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
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
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const projectMode = parseMode(project.mode)
            const ModeIcon = MODE_ICON[projectMode]
            const units = project.containers.reduce((sum, item) => sum + item.quantity, 0)
            const etdHint = project.etd ? relativeDays(project.etd) : ""
            const past = etdHint.endsWith("ago") || etdHint === "yesterday"
            const done = stepsDone(project.status.kind)
            const warn = project.status.tone === "warning"
            const href = `/projects/${project.id}?step=${project.status.step}`
            return (
              <li
                key={project.id}
                className="group flex flex-col rounded-lg border bg-card transition-shadow hover:border-primary/40 hover:shadow-raised"
              >
                <div className="flex items-start gap-3 p-4 pb-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", MODE_TINT[projectMode])} title={modeLabel(projectMode)}>
                    <ModeIcon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="block truncate text-[15px] font-semibold hover:text-primary">
                      {project.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {modeLabel(projectMode)} ·{" "}
                      {project.etd ? (
                        <span className={cn(past && "text-amber-700 dark:text-amber-400")} suppressHydrationWarning>
                          ETD {formatDate(project.etd)}
                          {etdHint ? ` (${etdHint})` : ""}
                        </span>
                      ) : (
                        "ETD missing"
                      )}
                    </p>
                  </div>
                  <Link
                    href={href}
                    className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium hover:opacity-80", TONE[project.status.tone])}
                    title="Open the step that needs attention"
                  >
                    {project.status.label}
                  </Link>
                </div>

                <div className="px-4">
                  <div
                    className="flex gap-1"
                    role="img"
                    aria-label={`${done} of 4 steps done${done < 4 ? `; next: ${STEP_NAMES[done]}` : ""}`}
                  >
                    {STEP_NAMES.map((name, index) => (
                      <span
                        key={name}
                        title={`${name}${index < done ? ": done" : index === done ? ": next" : ""}`}
                        className={cn(
                          "h-1.5 flex-1 rounded-full",
                          index < done ? "bg-primary" : index === done && warn ? "bg-amber-400" : "bg-muted",
                        )}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {done === 4 ? "All 4 steps done" : `Step ${done + 1} of 4: ${STEP_NAMES[done]}`}
                  </p>
                </div>

                <div className="flex min-h-9 flex-wrap items-center gap-1.5 px-4 pt-3">
                  {project.containers.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No equipment chosen yet</span>
                  ) : (
                    project.containers.map((item) => (
                      <span
                        key={item.equipmentTypeId}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                      >
                        <span className="truncate">
                          {item.quantity} × {item.name}
                        </span>
                        {canEdit ? (
                          <button
                            type="button"
                            className="rounded text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${item.name} from ${project.name}`}
                            onClick={() => setRemoving({ projectId: project.id, equipmentTypeId: item.equipmentTypeId, name: item.name })}
                          >
                            <X className="size-3" />
                          </button>
                        ) : null}
                      </span>
                    ))
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1 border-t px-3 py-2">
                  <p className="mr-auto pl-1 text-xs text-muted-foreground">
                    {project.pieces} piece{project.pieces === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}
                  </p>
                  {canEdit ? (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Edit ${project.name}`}
                        title="Edit details"
                        onClick={() => setEditingId(project.id)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Duplicate ${project.name}`}
                        title="Duplicate (copies cargo and equipment)"
                        disabled={duplicating === project.id}
                        onClick={() => void duplicate(project)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </>
                  ) : null}
                  {canDelete ? <DeleteProjectButton projectId={project.id} name={project.name} label="" /> : null}
                  <Button asChild size="sm" className="ml-1">
                    <Link href={href}>
                      Open
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
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
