import { canEditProjects, canManageEquipment, roleSchema } from "@compass/domain"
import { EquipmentBrowser } from "@/components/equipment-browser"
import { listEquipmentForOrg } from "@/lib/equipment-catalog"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Equipment library" }

export default async function EquipmentPage() {
  const user = await requireUser()
  const role = roleSchema.parse(user.role)
  const [items, projectRows] = await Promise.all([
    listEquipmentForOrg(user.orgId),
    prisma.project.findMany({
      where: { orgId: user.orgId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, etd: true },
    }),
  ])
  const projects = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    etd: project.etd ? project.etd.toISOString().slice(0, 10) : null,
  }))

  return (
    <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Equipment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Library of containers, ULDs, trucks, and pallets. Add a unit to a project — if none exists, create one first.
        </p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">The library is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">Run the seed script to import the equipment workbook.</p>
        </div>
      ) : (
        <EquipmentBrowser
          items={items}
          canManage={canManageEquipment(role)}
          canEditProjects={canEditProjects(role)}
          projects={projects}
        />
      )}
    </main>
  )
}
