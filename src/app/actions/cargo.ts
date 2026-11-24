"use server"

import { Prisma } from "@prisma/client"
import { cargoItemInputSchema, formatAllowedRotations, type CargoItemInput } from "@compass/domain"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { readTabularFile } from "@/lib/cargo-file"
import { cargoPreset } from "@/lib/cargo-defaults"
import { documentKind, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, type ExtractedCargo } from "@/lib/cargo-extract"
import { readCargoDocument } from "@/lib/cargo-extract-server"
import { importMappingSchema, MAX_IMPORT_ROWS, type TabularSheet } from "@/lib/cargo-import"
import { editorOrError } from "@/lib/editor"
import { prisma } from "@/lib/prisma"

const idSchema = z.string().min(1)

export async function addCargoItem(projectId: string, shape?: CargoItemInput["shape"]) {
  const project = await editableProject(projectId)
  if (!project.ok) return project

  await prisma.cargoItem.create({
    data: cargoData(project.projectId, cargoPreset(shape)),
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const }
}

export async function updateCargoItem(projectId: string, cargoId: string, input: CargoItemInput) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  if (!idSchema.safeParse(cargoId).success) return { ok: false as const, error: "Missing cargo id." }

  const parsed = cargoItemInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Check the dimensions, weight, and quantity." }

  const existing = await prisma.cargoItem.findFirst({
    where: { id: cargoId, projectId: project.projectId },
  })
  if (!existing) return { ok: false as const, error: "That cargo line is no longer in the project." }

  await prisma.cargoItem.update({
    where: { id: existing.id },
    data: cargoData(project.projectId, parsed.data),
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const }
}

export async function duplicateCargoItem(projectId: string, cargoId: string) {
  const project = await editableProject(projectId)
  if (!project.ok) return project

  const existing = await prisma.cargoItem.findFirst({
    where: { id: cargoId, projectId: project.projectId },
  })
  if (!existing) return { ok: false as const, error: "That cargo line is no longer in the project." }

  await prisma.cargoItem.create({
    data: {
      projectId: project.projectId,
      sku: existing.sku,
      name: `${existing.name} copy`,
      lengthCm: existing.lengthCm,
      widthCm: existing.widthCm,
      heightCm: existing.heightCm,
      weightKg: existing.weightKg,
      quantity: existing.quantity,
      shape: existing.shape,
      orientation: existing.orientation,
      customFields: existing.customFields ?? undefined,
      stackable: existing.stackable,
      bottomOnly: existing.bottomOnly,
      maxStackLoadKg: existing.maxStackLoadKg,
      maxStackLayers: existing.maxStackLayers,
      priority: existing.priority,
      destinationStop: existing.destinationStop,
      consignmentId: existing.consignmentId,
      segregationClass: existing.segregationClass,
      color: existing.color,
    },
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const }
}

export async function deleteCargoItems(projectId: string, cargoIds: string[]) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  const ids = z.array(idSchema).min(1).max(MAX_IMPORT_ROWS).safeParse(cargoIds)
  if (!ids.success) return { ok: false as const, error: "Choose at least one cargo line." }

  await prisma.cargoItem.deleteMany({
    where: { projectId: project.projectId, id: { in: ids.data } },
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const }
}

export async function bulkUpdateCargo(
  projectId: string,
  cargoIds: string[],
  patch: { stackable?: boolean; priority?: number; destinationStop?: number; shape?: CargoItemInput["shape"] },
) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  const ids = z.array(idSchema).min(1).safeParse(cargoIds)
  if (!ids.success) return { ok: false as const, error: "Choose at least one cargo line." }

  const data: Prisma.CargoItemUpdateManyMutationInput = {}
  if (typeof patch.stackable === "boolean") data.stackable = patch.stackable
  if (typeof patch.priority === "number" && Number.isInteger(patch.priority)) data.priority = patch.priority
  if (typeof patch.destinationStop === "number" && Number.isInteger(patch.destinationStop) && patch.destinationStop > 0) {
    data.destinationStop = patch.destinationStop
  }
  if (patch.shape === "BOX" || patch.shape === "CYLINDER_DRUM" || patch.shape === "PIPE") data.shape = patch.shape
  if (Object.keys(data).length === 0) return { ok: false as const, error: "Choose a value to apply." }

  await prisma.cargoItem.updateMany({
    where: { projectId: project.projectId, id: { in: ids.data } },
    data,
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const }
}

export async function previewCargoFile(formData: FormData): Promise<{ sheet: TabularSheet } | { error: string }> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }

  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "Choose an Excel or CSV file." }
  const name = file.name.toLowerCase()
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
    return { error: "Use an .xlsx or .csv file." }
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { sheet: readTabularFile(bytes) }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be read."
    return { error: message }
  }
}

/** Reads a photo or PDF of a packing list with Claude and returns cargo lines for the planner to review. */
export async function extractCargoFromDocument(
  formData: FormData,
): Promise<{ cargo: ExtractedCargo } | { error: string }> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }

  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "Choose a photo or PDF of the packing list." }
  const document = documentKind(file.name, file.type)
  if (!document) return { error: "Use a PDF, JPG, PNG or WebP file. For spreadsheets, use an .xlsx or .csv file." }
  if (file.size === 0) return { error: "That file is empty." }
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "That file is over 10 MB. Use a smaller scan or fewer pages." }
  if (document.kind === "image" && file.size > MAX_IMAGE_BYTES) {
    return { error: "That image is over 5 MB. Save it smaller, or take a screenshot of the list instead." }
  }

  const rawMode = formData.get("mode")
  const mode = typeof rawMode === "string" && rawMode ? rawMode.toLowerCase() : "sea"
  const result = await readCargoDocument({
    bytes: new Uint8Array(await file.arrayBuffer()),
    document,
    modeLabel: ["sea", "air", "road", "pallet"].includes(mode) ? mode : "sea",
  })
  return result.ok ? { cargo: result.cargo } : { error: result.error }
}

export async function importCargoRows(projectId: string, rows: CargoItemInput[]) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  const parsed = z.array(cargoItemInputSchema).min(1).max(MAX_IMPORT_ROWS).safeParse(rows)
  if (!parsed.success) return { ok: false as const, error: "The import has no valid cargo rows." }

  await prisma.cargoItem.createMany({
    data: parsed.data.map((row) => cargoData(project.projectId, row)),
  })
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const, count: parsed.data.length }
}

export async function saveImportTemplate(name: string, mapping: unknown) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }
  const templateName = z.string().trim().min(1).max(80).safeParse(name)
  const parsedMapping = importMappingSchema.safeParse(mapping)
  if (!templateName.success || !parsedMapping.success) {
    return { ok: false as const, error: "Name the template and map the required columns." }
  }

  await prisma.importMappingTemplate.upsert({
    where: { orgId_name: { orgId: access.user.orgId, name: templateName.data } },
    update: { mapping: mappingJson(parsedMapping.data) },
    create: {
      orgId: access.user.orgId,
      name: templateName.data,
      mapping: mappingJson(parsedMapping.data),
    },
  })
  return { ok: true as const }
}

async function editableProject(
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const access = await editorOrError()
  if (!access.ok) return access
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    select: { id: true },
  })
  if (!project) return { ok: false, error: "That project is not in this organization." }
  return { ok: true, projectId: project.id }
}

function cargoData(projectId: string, input: CargoItemInput) {
  return {
    projectId,
    sku: input.sku,
    name: input.name,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    quantity: input.quantity,
    shape: input.shape,
    orientation: input.orientation,
    customFields: rotationsJson(input),
    stackable: input.stackable,
    bottomOnly: input.bottomOnly,
    maxStackLoadKg: input.maxStackLoadKg,
    maxStackLayers: input.maxStackLayers,
    priority: input.priority,
    destinationStop: input.destinationStop,
    consignmentId: input.consignmentId,
    segregationClass: input.segregationClass,
    color: input.color,
  }
}

function rotationsJson(input: CargoItemInput): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const allowed = input.orientation === "CUSTOM" ? formatAllowedRotations(input.allowedRotations) : null
  if (!allowed) return Prisma.DbNull
  return { allowedRotations: allowed }
}

function mappingJson(mapping: z.infer<typeof importMappingSchema>): Prisma.InputJsonObject {
  return {
    lengthUnit: mapping.lengthUnit,
    weightUnit: mapping.weightUnit,
    columns: mapping.columns,
  }
}
