"use client"

import { ChevronRight, Folder, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { deleteProject, removeEquipmentFromProject } from "@/app/actions/projects"
import { ProjectEditForm } from "@/components/project-edit-form"
import { Button } from "@/components/ui/button"
import { equipmentModeSchema, modeLabel } from "@compass/domain"
import { cn } from "@/lib/utils"

export type ProjectFolder = {
  id: string
  name: string
  mode: string
  etd: string | null
  notes: string | null
  cargoCount: number
  containers: { equipmentTypeId: string; name: string; mode: string; quantity: number }[]
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
  const [openId, setOpenId] = useState<string | null>(projects[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function removeUnit(projectId: string, equipmentTypeId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this project?`)) return
    const result = await removeEquipmentFromProject(projectId, equipmentTypeId)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Removed ${name}.`)
    router.refresh()
  }

  if (projects.length === 0) return null

  return (
    <ul className="divide-y overflow-hidden rounded-md border bg-card">
      {projects.map((project) => {
        const open = openId === project.id
        const units = project.containers.reduce((sum, item) => sum + item.quantity, 0)
        return (
          <li key={project.id}>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setOpenId(open ? null : project.id)}
              >
                <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                <Folder className="size-4 shrink-0 text-amber-600" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{project.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {project.etd ? `ETD ${project.etd}` : "ETD missing"} · {units} unit{units === 1 ? "" : "s"} ·{" "}
                    {project.cargoCount} cargo
                  </span>
                </span>
              </button>
              <Link href={`/projects/${project.id}`} className="text-sm text-primary hover:underline">
                Open
              </Link>
              {canEdit ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(project.id)}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              ) : null}
              {canDelete ? <DeleteFolderButton projectId={project.id} name={project.name} /> : null}
            </div>
            {editingId === project.id ? (
              <div className="border-t bg-muted/30 px-4 py-3">
                <ProjectEditForm
                  project={project}
                  onClose={() => setEditingId(null)}
                />
              </div>
            ) : null}
            {open ? (
              <ul className="border-t bg-muted/20 px-4 py-2">
                {project.containers.length === 0 ? (
                  <li className="px-8 py-2 text-sm text-muted-foreground">
                    No containers yet. Open the project and add containers, ULDs, or trucks in Setup.
                  </li>
                ) : (
                  project.containers.map((item) => (
                    <li key={item.equipmentTypeId} className="flex items-center justify-between gap-2 py-1.5 pl-8 text-sm">
                      <span>
                        {item.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {equipmentModeSchema.safeParse(item.mode).success
                            ? modeLabel(equipmentModeSchema.parse(item.mode))
                            : item.mode}{" "}
                          · ×{item.quantity}
                        </span>
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => void removeUnit(project.id, item.equipmentTypeId, item.name)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function DeleteFolderButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter()
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={async () => {
        if (!window.confirm(`Delete project “${name}” and its cargo?`)) return
        const result = await deleteProject(projectId)
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success("Project deleted.")
        router.refresh()
      }}
    >
      <Trash2 className="size-3.5" />
      Delete
    </Button>
  )
}
