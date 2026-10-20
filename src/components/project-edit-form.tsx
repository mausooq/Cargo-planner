"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { updateProjectMeta } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProjectEditForm({
  project,
  onClose,
}: {
  project: { id: string; name: string; etd: string | null; notes: string | null }
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(project.name)
  const [etd, setEtd] = useState(project.etd ?? "")
  const [notes, setNotes] = useState(project.notes ?? "")
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error("Give the project a name.")
      return
    }
    if (!etd) {
      toast.error("ETD is required.")
      return
    }
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
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`edit-name-${project.id}`}>Name</Label>
        <Input id={`edit-name-${project.id}`} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-etd-${project.id}`}>ETD</Label>
        <Input id={`edit-etd-${project.id}`} type="date" value={etd} onChange={(event) => setEtd(event.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`edit-notes-${project.id}`}>Notes</Label>
        <Input id={`edit-notes-${project.id}`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
