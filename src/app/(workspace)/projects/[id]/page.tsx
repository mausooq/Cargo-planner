import { Suspense } from "react"
import { notFound } from "next/navigation"
import {
  canDeleteProjects,
  canEditProjects,
  cargoShapeSchema,
  equipmentModeSchema,
  equipmentRoleSchema,
  objectiveSchema,
  orientationSchema,
  parseAllowedRotations,
  roleSchema,
} from "@compass/domain"
import type { CargoLine } from "@/components/cargo-grid"
import { recordOf } from "@/lib/json"
import type { EquipmentChoice } from "@/components/equipment-setup"
import { PlannerApp } from "@/components/planner-app"
import { importMappingSchema } from "@/lib/cargo-import"
import { listEquipmentForOrg } from "@/lib/equipment-catalog"
import { planFromDb } from "@/lib/plan-from-db"
import { projectMinSupportPct } from "@/lib/support-policy"
import { isPlanStale } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Load plan" }

/** What an import could not settle for a draft line, stored with it. Only text is read back. */
function importNotesOf(value: unknown): string[] {
  const raw = recordOf(value).importNotes
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : []
}

function storedRotations(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = (value as { allowedRotations?: unknown }).allowedRotations
  return typeof raw === "string" ? raw : null
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const project = await prisma.project.findFirst({
    where: { id, orgId: user.orgId },
    include: {
      cargoItems: { orderBy: { createdAt: "asc" } },
      candidates: true,
      plans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          unloaded: { include: { cargoItem: true } },
          instances: {
            include: {
              equipmentType: true,
              placements: { include: { cargoItem: true } },
            },
          },
        },
      },
    },
  })
  if (!project) notFound()

  const role = roleSchema.parse(user.role)
  const canEdit = canEditProjects(role)
  const canDelete = canDeleteProjects(role)
  const lines: CargoLine[] = project.cargoItems.map((item) => ({
    id: item.id,
    updatedAt: item.updatedAt.toISOString(),
    sku: item.sku,
    name: item.name,
    lengthCm: item.lengthCm,
    widthCm: item.widthCm,
    heightCm: item.heightCm,
    weightKg: item.weightKg,
    quantity: item.quantity,
    shape: cargoShapeSchema.parse(item.shape),
    orientation: orientationSchema.safeParse(item.orientation).success
      ? orientationSchema.parse(item.orientation)
      : "ROTATE_90",
    allowedRotations: parseAllowedRotations(storedRotations(item.customFields)),
    stackable: item.stackable,
    bottomOnly: item.bottomOnly,
    maxStackLoadKg: item.maxStackLoadKg,
    maxStackLayers: item.maxStackLayers,
    priority: item.priority,
    destinationStop: item.destinationStop,
    consignmentId: item.consignmentId,
    segregationClass: item.segregationClass,
    color: item.color,
    importNotes: importNotesOf(item.customFields),
  }))

  const library = await listEquipmentForOrg(user.orgId)
  const choices: EquipmentChoice[] = project.candidates.flatMap((candidate) => {
    if (!candidate.equipmentTypeId) return []
    const parsedRole = equipmentRoleSchema.safeParse(candidate.role)
    return [
      {
        equipmentTypeId: candidate.equipmentTypeId,
        role: parsedRole.success ? parsedRole.data : "PRIMARY",
        maxCount: candidate.maxCount,
      },
    ]
  })

  const storedTemplates = await prisma.importMappingTemplate.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: "asc" },
  })
  const templates = storedTemplates.flatMap((template) => {
    const mapping = importMappingSchema.safeParse(template.mapping)
    if (!mapping.success) return []
    return [{ id: template.id, name: template.name, mapping: mapping.data }]
  })

  const latest = project.plans[0]
  const plan = latest ? planFromDb(latest) : null
  const minSupportPct = projectMinSupportPct(project.rules)
  const planStale = latest ? isPlanStale(latest, project.cargoItems) : false

  return (
    <main id="main">
      <Suspense fallback={<div className="px-4 py-10 text-sm text-muted-foreground">Opening planner…</div>}>
        <PlannerApp
          project={{
            id: project.id,
            name: project.name,
            mode: equipmentModeSchema.safeParse(project.mode).success
              ? equipmentModeSchema.parse(project.mode)
              : "SEA",
            objective: objectiveSchema.parse(project.objective),
            etd: project.etd ? project.etd.toISOString().slice(0, 10) : null,
            notes: project.notes,
            minSupportPct,
          }}
          cargo={lines}
          library={library}
          choices={choices}
          plan={plan}
          planStale={planStale}
          templates={templates}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </Suspense>
    </main>
  )
}
