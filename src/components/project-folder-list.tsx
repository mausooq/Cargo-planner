"use client"

import { ArrowUpRight, ChevronRight, Copy, Pencil, Search } from "lucide-react"
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
import { relativeDays, type ProjectStatus } from "@/lib/project-status"
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

const TONE: Record<ProjectStatus["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  action: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
}

function safeModeLabel(mode: string): string {
  const parsed = equipmentModeSchema.safeParse(mode)
  return parsed.success ? modeLabel(parsed.data) : mode
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
  const [sort, setSort] = useState<SortKey>("recent")
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ projectId: string; equipmentTypeId: string; name: string } | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)

  const modesInUse = MODE_ORDER.filter((entry) => projects.some((project) => project.mode === entry))
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = projects.filter((project) => {
      if (mode !== "ALL" && project.mode !== mode) return false
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
  }, [mode, projects, query, sort])

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or equipment"
            aria-label="Search projects"
            className="pl-9"
          />
        </div>
        {modesInUse.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by mode">
            {(["ALL", ...modesInUse] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={mode === entry}
                onClick={() => setMode(entry)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium",
                  mode === entry ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
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
            className="h-9 rounded-md border bg-background px-2 text-sm"
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
        <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No projects match.{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setQuery("")
              setMode("ALL")
            }}
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border bg-card">
          {visible.map((project) => {
            const open = openId === project.id
            const units = project.containers.reduce((sum, item) => sum + item.quantity, 0)
            const etdHint = project.etd ? relativeDays(project.etd) : ""
            const past = etdHint.endsWith("ago") || etdHint === "yesterday"
            return (
              <li key={project.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-expanded={open}
                    aria-label={open ? `Hide equipment for ${project.name}` : `Show equipment for ${project.name}`}
                    onClick={() => setOpenId(open ? null : project.id)}
                  >
                    <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/projects/${project.id}?step=${project.status.step}`}
                      className="block truncate font-medium hover:text-primary hover:underline"
                    >
                      {project.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {safeModeLabel(project.mode)} ·{" "}
                      {project.etd ? (
                        <span className={cn(past && "text-amber-700 dark:text-amber-400")} suppressHydrationWarning>
                          ETD {formatDate(project.etd)}
                          {etdHint ? ` (${etdHint})` : ""}
                        </span>
                      ) : (
                        "ETD missing"
                      )}{" "}
                      · {project.pieces} piece{project.pieces === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Link
                    href={`/projects/${project.id}?step=${project.status.step}`}
                    className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium hover:opacity-80", TONE[project.status.tone])}
                    title="Open the step that needs attention"
                  >
                    {project.status.label}
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/projects/${project.id}?step=${project.status.step}`}>
                        Open
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </Button>
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
                  </div>
                </div>
                {open ? (
                  <ul className="border-t bg-muted/20 px-4 py-2">
                    {project.containers.length === 0 ? (
                      <li className="py-2 pl-9 text-sm text-muted-foreground">
                        No equipment yet.{" "}
                        <Link href={`/projects/${project.id}?step=setup`} className="text-primary hover:underline">
                          Choose equipment
                        </Link>
                      </li>
                    ) : (
                      project.containers.map((item) => (
                        <li key={item.equipmentTypeId} className="flex items-center justify-between gap-2 py-1.5 pl-9 text-sm">
                          <span>
                            {item.name}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {safeModeLabel(item.mode)} · up to {item.quantity}
                            </span>
                          </span>
                          {canEdit ? (
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                setRemoving({ projectId: project.id, equipmentTypeId: item.equipmentTypeId, name: item.name })
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </li>
                      ))
                    )}
                    {project.notes ? <li className="py-1.5 pl-9 text-xs text-muted-foreground">Notes: {project.notes}</li> : null}
                  </ul>
                ) : null}
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
