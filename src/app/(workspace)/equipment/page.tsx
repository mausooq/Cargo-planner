import { Suspense } from "react"
import { canEditProjects, canManageEquipment, roleSchema } from "@compass/domain"
import { Container } from "lucide-react"
import { IconTile } from "@/components/design-system"
import { EquipmentBrowser } from "@/components/equipment-browser"
import { listEquipmentForOrg } from "@/lib/equipment-catalog"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Equipment library" }

export default async function EquipmentPage() {
  const user = await requireUser()
  const role = roleSchema.parse(user.role)
  const canEdit = canEditProjects(role)
  const [items, projectRows] = await Promise.all([
    listEquipmentForOrg(user.orgId),
    canEdit
      ? prisma.project.findMany({
          where: { orgId: user.orgId },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, etd: true },
        })
      : Promise.resolve([]),
  ])
  const projects = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    etd: project.etd ? project.etd.toISOString().slice(0, 10) : null,
  }))

  return (
    // The workspace gradient fills everything under the header.
    <div className="bg-workspace min-h-[calc(100dvh-3.5rem)] font-brand">
    <main id="main" className="mx-auto w-full max-w-[1800px] px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <IconTile icon={Container} tint="mint" size="lg" />
        <div className="min-w-0">
          <h1 className="text-page-title">Equipment Library</h1>
          <p className="mt-1 text-page-desc text-muted-foreground">
            Containers, ULDs, trucks and pallets with their inside sizes and payloads. Add a unit to a project; if there is none yet, create one first.
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">The library is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">Run the seed script to import the equipment workbook.</p>
        </div>
      ) : (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the library…</p>}>
          <EquipmentBrowser
            items={items}
            canManage={canManageEquipment(role)}
            canEditProjects={canEdit}
            projects={projects}
          />
        </Suspense>
      )}
    </main>
    </div>
  )
}
