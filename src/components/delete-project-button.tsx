"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { deleteProject } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!window.confirm("Delete this project and its cargo?")) return
        const result = await deleteProject(projectId)
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        router.push("/dashboard")
        router.refresh()
      }}
    >
      Delete project
    </Button>
  )
}
