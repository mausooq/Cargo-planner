import Link from "next/link"
import { Boxes, ClipboardList, PackageCheck } from "lucide-react"
import { canDeleteProjects, canEditProjects, roleSchema } from "@compass/domain"
import { ProjectCreateForm } from "@/components/project-create-form"
import { ProjectFolderList, type ProjectFolder } from "@/components/project-folder-list"
import { prisma } from "@/lib/prisma"
import { isPlanStale } from "@/lib/plan-staleness"
import { projectStatus } from "@/lib/project-status"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Projects" }

export default async function DashboardPage() {
  const user = await requireUser()
  const role = roleSchema.parse(user.role)
  const canEdit = canEditProjects(role)
  const canDelete = canDeleteProjects(role)
  const rows = await prisma.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { updatedAt: "desc" },
    include: {
      cargoItems: true,
      candidates: { include: { equipmentType: { select: { id: true, name: true, mode: true } } } },
      plans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, settings: true, _count: { select: { unloaded: true } } },
      },
    },
  })

  const projects: ProjectFolder[] = rows.map((project) => {
    const latest = project.plans[0] ?? null
    const lastCargoChange = project.cargoItems.reduce<Date | null>(
      (latestChange, item) => (!latestChange || item.updatedAt > latestChange ? item.updatedAt : latestChange),
      null,
    )
    const containers = project.candidates.flatMap((candidate) => {
      if (!candidate.equipmentType) return []
      return [
        {
          equipmentTypeId: candidate.equipmentType.id,
          name: candidate.equipmentType.name,
          mode: candidate.equipmentType.mode,
          quantity: candidate.maxCount ?? 1,
        },
      ]
    })
    const activity = [project.updatedAt, latest?.createdAt, lastCargoChange].filter((date): date is Date => Boolean(date))
    return {
      id: project.id,
      name: project.name,
      mode: project.mode,
      etd: project.etd ? project.etd.toISOString().slice(0, 10) : null,
      notes: project.notes,
      cargoCount: project.cargoItems.length,
      pieces: project.cargoItems.reduce((sum, item) => sum + item.quantity, 0),
      updatedAt: new Date(Math.max(...activity.map((date) => date.getTime()))).toISOString(),
      containers,
      status: projectStatus({
        cargoCount: project.cargoItems.length,
        equipmentCount: containers.length,
        plan: latest
          ? {
              createdAt: latest.createdAt,
              unloadedCount: latest._count.unloaded,
              // The same rule as the project page, so the list and the stepper agree.
              stale: isPlanStale(latest, project.cargoItems),
            }
          : null,
        lastCargoChange,
      }),
    }
  })

  return (
    <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each project is one shipment: its cargo, the equipment to load it into, and the load plan.
          </p>
        </div>
        {canEdit && projects.length > 0 ? <ProjectCreateForm size="default" /> : null}
      </div>

      <section className="mt-5">
        {projects.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-4 py-12 text-center">
            <p className="text-base font-medium">Plan your first shipment</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              {canEdit
                ? "Create a project, then follow three steps. It takes a few minutes for a typical packing list."
                : "No projects yet. A planner or admin needs to create one."}
            </p>
            <ol className="mx-auto mt-6 grid max-w-3xl gap-3 text-left text-sm sm:grid-cols-3">
              <Step icon={ClipboardList} title="1. Add cargo" text="Type lines or import your packing list from Excel." />
              <Step icon={Boxes} title="2. Pick equipment" text="Choose containers, trucks, ULDs, or pallets and how many." />
              <Step icon={PackageCheck} title="3. Get the plan" text="See it in 3D, adjust by hand, then print or export." />
            </ol>
            {canEdit ? (
              <div className="mt-6 flex justify-center">
                <ProjectCreateForm size="default" />
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              Want to see what is available first?{" "}
              <Link href="/equipment" className="text-primary hover:underline">
                Browse the equipment library
              </Link>
            </p>
          </div>
        ) : (
          <ProjectFolderList projects={projects} canEdit={canEdit} canDelete={canDelete} />
        )}
      </section>
    </main>
  )
}

function Step({ icon: Icon, title, text }: { icon: typeof Boxes; title: string; text: string }) {
  return (
    <li className="rounded-md border bg-background p-3">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <p className="mt-2 font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{text}</p>
    </li>
  )
}
