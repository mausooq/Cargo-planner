import {
  axleGroupSchema,
  equipmentModeSchema,
  oogClassSchema,
  type AxleGroup,
  type EquipmentMode,
  type OogClass,
} from "@compass/domain"
import { prisma } from "@/lib/prisma"
import { parseContour, type UldContour } from "@/lib/uld-contour"

export const MODE_ORDER: EquipmentMode[] = ["SEA", "AIR", "ROAD", "PALLET"]

export type EquipmentListItem = {
  id: string
  externalId: string | null
  mode: EquipmentMode
  name: string
  code: string
  sizeLabel: string | null
  innerLengthCm: number
  innerWidthCm: number
  innerHeightCm: number
  heightOpen: boolean
  maxPayloadKg: number
  tareKg: number
  grossKg: number
  floors: number
  axleGroups: AxleGroup[]
  costPerUnit: number
  oogClass: OogClass
  extendable: boolean
  maxExtendedLengthCm: number | null
  notes: string | null
  isCustom: boolean
  contour: UldContour
  doorWidthCm: number | null
  doorHeightCm: number | null
  projectCount: number
  maxCount?: number
}

export async function listEquipmentForOrg(orgId: string): Promise<EquipmentListItem[]> {
  const rows = await prisma.equipmentType.findMany({
    where: { OR: [{ orgId: null }, { orgId }] },
    include: {
      projectCandidates: { select: { projectId: true } },
      instances: { select: { plan: { select: { projectId: true } } } },
    },
  })

  const items = rows.map((row) => {
    const mode = equipmentModeSchema.parse(row.mode)
    const oogClass = oogClassSchema.parse(row.oogClass)
    const axleGroups = axleGroupSchema.array().parse(row.axleGroups)
    return {
      id: row.id,
      externalId: row.externalId,
      mode,
      name: row.name,
      code: row.code,
      sizeLabel: row.sizeLabel,
      innerLengthCm: row.innerLengthCm,
      innerWidthCm: row.innerWidthCm,
      innerHeightCm: row.innerHeightCm,
      heightOpen: row.heightOpen,
      maxPayloadKg: row.maxPayloadKg,
      tareKg: row.tareKg,
      grossKg: row.maxPayloadKg + row.tareKg,
      floors: row.floors,
      axleGroups,
      costPerUnit: row.costPerUnit,
      oogClass,
      extendable: row.extendable,
      maxExtendedLengthCm: row.maxExtendedLengthCm,
      notes: row.notes,
      isCustom: row.isCustom,
      contour: parseContour(row.contour),
      doorWidthCm: row.doorWidthCm,
      doorHeightCm: row.doorHeightCm,
      projectCount: projectIds(row).size,
    } satisfies EquipmentListItem
  })

  items.sort((left, right) => {
    const modeDelta = MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode)
    if (modeDelta !== 0) return modeDelta
    return left.name.localeCompare(right.name)
  })

  return items
}

function projectIds(row: {
  projectCandidates: { projectId: string }[]
  instances: { plan: { projectId: string } }[]
}) {
  const ids = new Set<string>()
  for (const candidate of row.projectCandidates) ids.add(candidate.projectId)
  for (const instance of row.instances) ids.add(instance.plan.projectId)
  return ids
}

export async function countEquipmentByMode(orgId: string): Promise<Record<EquipmentMode, number>> {
  const items = await listEquipmentForOrg(orgId)
  const counts: Record<EquipmentMode, number> = { SEA: 0, AIR: 0, ROAD: 0, PALLET: 0 }
  for (const item of items) counts[item.mode] += 1
  return counts
}
