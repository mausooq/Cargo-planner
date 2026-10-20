import Link from "next/link"
import { canDeleteProjects, canEditProjects, modeLabel, roleLabel, roleSchema } from "@compass/domain"
import { ProjectCreateForm } from "@/components/project-create-form"
import { ProjectFolderList, type ProjectFolder } from "@/components/project-folder-list"
import { Button } from "@/components/ui/button"
import { MODE_ORDER, countEquipmentByMode } from "@/lib/equipment-catalog"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Projects" }

export default async function DashboardPage() {
  const user = await requireUser()
  const role = roleSchema.parse(user.role)
  const canEdit = canEditProjects(role)
  const canDelete = canDeleteProjects(role)
  const [counts, rows] = await Promise.all([
    countEquipmentByMode(user.orgId),
    prisma.project.findMany({
      where: { orgId: user.orgId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { cargoItems: true } },
        candidates: { include: { equipmentType: { select: { id: true, name: true, mode: true } } } },
      },
    }),
  ])

  const projects: ProjectFolder[] = rows.map((project) => ({
    id: project.id,
    name: project.name,
    mode: project.mode,
    etd: project.etd ? project.etd.toISOString().slice(0, 10) : null,
    notes: project.notes,
    cargoCount: project._count.cargoItems,
    containers: project.candidates.flatMap((candidate) => {
      if (!candidate.equipmentType) return []
      return [
        {
          equipmentTypeId: candidate.equipmentType.id,
          name: candidate.equipmentType.name,
          mode: candidate.equipmentType.mode,
          quantity: candidate.maxCount ?? 1,
        },
      ]
    }),
  }))

  return (
    <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {roleLabel(user.role)} · each project is a folder for containers, ULDs, and trucks. ETD is required.
          </p>
        </div>
        {canEdit ? <ProjectCreateForm /> : null}
      </div>

      <section className="mt-5 overflow-hidden rounded-md border bg-card" aria-label="Library counts">
        <table className="sheet-table w-full text-left text-sm">
          <thead className="bg-muted/70">
            <tr>
              {MODE_ORDER.map((mode) => (
                <th key={mode} className="px-3 py-2">
                  {modeLabel(mode)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {MODE_ORDER.map((mode) => (
                <td key={mode} className="px-3 py-2 font-medium">
                  {counts[mode]} types
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        {projects.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
            <p className="text-sm font-medium">No projects</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project with an ETD, then add containers, ULDs, or trucks to it.
            </p>
            <Button asChild className="mt-4" variant="outline" size="sm">
              <Link href="/equipment">Browse equipment</Link>
            </Button>
          </div>
        ) : (
          <ProjectFolderList projects={projects} canEdit={canEdit} canDelete={canDelete} />
        )}
      </section>
    </main>
  )
}
