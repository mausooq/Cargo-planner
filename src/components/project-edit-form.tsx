"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { ETD_IN_PAST_MESSAGE, isPastEtd, localIsoDate } from "@compass/domain"
import { updateProjectMeta } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type EditableProject = { id: string; name: string; etd: string | null; notes: string | null }

export function ProjectEditDialog({
  project,
  open,
  onOpenChange,
}: {
  project: EditableProject
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Change the name, departure date, or notes.</DialogDescription>
        </DialogHeader>
        {/* Remount on open so the fields start from the saved values each time. */}
        {open ? <ProjectEditForm project={project} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

export function ProjectEditForm({ project, onClose }: { project: EditableProject; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(project.name)
  const [etd, setEtd] = useState(project.etd ?? "")
  const [notes, setNotes] = useState(project.notes ?? "")
  const [errors, setErrors] = useState<{ name?: string; etd?: string }>({})
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    if (!name.trim()) nextErrors.name = "Give the project a name."
    if (!etd) nextErrors.etd = "ETD is required."
    // An old project may keep the past ETD it already has; a new or changed date must be today or later.
    else if (etd !== (project.etd ?? "") && isPastEtd(etd)) nextErrors.etd = ETD_IN_PAST_MESSAGE
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    const result = await updateProjectMeta(project.id, { name, etd, notes })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Project updated.")
    onClose()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-name-${project.id}`}>Name</Label>
        <Input
          id={`edit-name-${project.id}`}
          value={name}
          autoFocus
          aria-invalid={Boolean(errors.name)}
          onChange={(event) => setName(event.target.value)}
        />
        {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-etd-${project.id}`}>ETD (estimated departure)</Label>
        <Input
          id={`edit-etd-${project.id}`}
          type="date"
          min={localIsoDate()}
          value={etd}
          aria-invalid={Boolean(errors.etd)}
          onChange={(event) => setEtd(event.target.value)}
        />
        {errors.etd ? (
          <p className="text-sm text-destructive">{errors.etd}</p>
        ) : etd && isPastEtd(etd) ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This departure date has passed. Pick a new one if the shipment moved.
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-notes-${project.id}`}>Notes</Label>
        <Input
          id={`edit-notes-${project.id}`}
          value={notes}
          placeholder="Optional"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <DialogFooter className="pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  )
}
