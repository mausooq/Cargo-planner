"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { addEquipmentToProject } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export type ProjectOption = { id: string; name: string; etd: string | null }

export function AddToProjectDialog({
  equipmentTypeId,
  equipmentName,
  projects,
}: {
  equipmentTypeId: string
  equipmentName: string
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!projectId) {
      toast.error("Select a project first.")
      return
    }
    setSaving(true)
    const result = await addEquipmentToProject(projectId, equipmentTypeId, quantity)
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Added ${equipmentName} to the project.`)
    setOpen(false)
    router.push(`/projects/${result.projectId}?step=setup`)
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add to project
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-md rounded-md border bg-card p-4" role="dialog" aria-label="Select a project">
            <h2 className="text-base font-semibold">Add {equipmentName}</h2>
            {projects.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Select a project first. Create one on the Projects page with an ETD, then add this container.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="add-project">Project</Label>
                  <select
                    id="add-project"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                        {project.etd ? ` · ETD ${project.etd}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-qty">Quantity</Label>
                  <input
                    id="add-qty"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                    className="h-9 w-24 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              {projects.length === 0 ? (
                <Button type="button" size="sm" onClick={() => router.push("/dashboard")}>
                  Go to projects
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
                  {saving ? "Adding…" : "Add"}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
