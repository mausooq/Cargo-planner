"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { projectCreateSchema, type ProjectCreateInput } from "@compass/domain"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { createProject } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProjectCreateForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<ProjectCreateInput>({
    resolver: zodResolver(projectCreateSchema),
    defaultValues: { name: "", mode: "SEA", etd: "", notes: "", objective: "FEWEST_UNITS" },
  })

  async function onSubmit(values: ProjectCreateInput) {
    const result = await createProject(values)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setOpen(false)
    router.push(`/projects/${result.id}`)
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        New project
      </Button>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4">
          <div
            className="w-full max-w-lg rounded-md border bg-card p-4"
            role="dialog"
            aria-label="New project"
          >
            <h2 className="text-base font-semibold">New project</h2>
            <p className="mt-1 text-sm text-muted-foreground">A folder for containers, ULDs, and trucks. ETD is required.</p>
            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-3">
              <Field label="Name" htmlFor="project-name" error={form.formState.errors.name?.message}>
                <Input id="project-name" placeholder="FZO project" {...form.register("name")} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type" htmlFor="project-mode">
                  <select id="project-mode" className="h-9 w-full rounded-md border bg-background px-3 text-sm" {...form.register("mode")}>
                    <option value="SEA">Sea</option>
                    <option value="ROAD">Road</option>
                    <option value="AIR">Air</option>
                    <option value="PALLET">Pallets</option>
                  </select>
                </Field>
                <Field label="ETD" htmlFor="project-etd" error={form.formState.errors.etd?.message}>
                  <Input id="project-etd" type="date" required {...form.register("etd")} />
                </Field>
              </div>
              <Field label="Objective" htmlFor="project-objective">
                <select id="project-objective" className="h-9 w-full rounded-md border bg-background px-3 text-sm" {...form.register("objective")}>
                  <option value="FEWEST_UNITS">Fewest units</option>
                  <option value="LOWEST_COST">Lowest total cost</option>
                </select>
              </Field>
              <Field label="Notes" htmlFor="project-notes">
                <Input id="project-notes" {...form.register("notes")} />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Creating…" : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
