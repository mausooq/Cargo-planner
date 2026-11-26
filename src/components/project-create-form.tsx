"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { localIsoDate, projectCreateFormSchema, type ProjectCreateInput } from "@compass/domain"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { createProject } from "@/app/actions/projects"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-3 text-sm"

export function ProjectCreateForm({ size = "sm" }: { size?: "sm" | "default" | "lg" }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<ProjectCreateInput>({
    resolver: zodResolver(projectCreateFormSchema),
    defaultValues: { name: "", mode: "SEA", etd: "", notes: "", objective: "FEWEST_UNITS" },
  })

  async function onSubmit(values: ProjectCreateInput) {
    const result = await createProject(values)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setOpen(false)
    form.reset()
    toast.success("Project created. Start by adding cargo.")
    router.push(`/projects/${result.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size={size} className={size === "lg" ? "press h-11 rounded-xl px-5 text-[15px] font-semibold shadow-soft hover:shadow-lift" : undefined}>
          <Plus className="size-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project holds one shipment: its cargo, the containers, ULDs, or trucks to use, and the load plan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <Field label="Name" htmlFor="project-name" error={form.formState.errors.name?.message}>
            <Input
              id="project-name"
              placeholder="e.g. Jebel Ali – March shipment"
              autoFocus
              aria-invalid={Boolean(form.formState.errors.name)}
              {...form.register("name")}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Transport mode" htmlFor="project-mode" hint="Filters the equipment list in Setup.">
              <select id="project-mode" className={SELECT_CLASS} {...form.register("mode")}>
                <option value="SEA">Sea</option>
                <option value="ROAD">Road</option>
                <option value="AIR">Air</option>
                <option value="PALLET">Pallets</option>
              </select>
            </Field>
            <Field label="ETD (estimated departure)" htmlFor="project-etd" error={form.formState.errors.etd?.message}>
              <Input
                id="project-etd"
                type="date"
                // Greys out past days in the date picker.
                min={localIsoDate()}
                aria-invalid={Boolean(form.formState.errors.etd)}
                {...form.register("etd")}
              />
            </Field>
          </div>
          <Field
            label="Optimise for"
            htmlFor="project-objective"
            hint="Fewest units packs tightly. Lowest cost weighs each unit's price."
          >
            <select id="project-objective" className={SELECT_CLASS} {...form.register("objective")}>
              <option value="FEWEST_UNITS">Fewest units</option>
              <option value="LOWEST_COST">Lowest total cost</option>
            </select>
          </Field>
          <Field label="Notes" htmlFor="project-notes">
            <Input id="project-notes" placeholder="Optional" {...form.register("notes")} />
          </Field>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
