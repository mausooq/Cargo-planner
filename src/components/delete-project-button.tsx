"use client"

import { Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { deleteProject } from "@/app/actions/projects"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"

export function DeleteProjectButton({
  projectId,
  name,
  redirectTo,
  label = "Delete project",
  className,
}: {
  projectId: string
  name: string
  /** Where to go after deleting. Omit to stay and refresh the current page. */
  redirectTo?: string
  label?: string
  /** Extra classes for the labelled button. */
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      {label ? (
        <Button type="button" variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
          <Trash2 className="size-3.5" />
          {label}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="press size-9 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${name}`}
          title="Delete project"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={`Delete “${name}”?`}
        description="This removes the project, its cargo lines, and its load plans. It cannot be undone."
        confirmLabel="Delete project"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          const result = await deleteProject(projectId)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`Deleted “${name}”.`)
          if (redirectTo) router.push(redirectTo)
          router.refresh()
        }}
      />
    </>
  )
}
