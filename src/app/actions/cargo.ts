"use server"

import { Prisma } from "@prisma/client"
import { cargoItemInputSchema, formatAllowedRotations, type CargoItemInput } from "@compass/domain"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { cargoPreset } from "@/lib/cargo-defaults"
import { documentKind, extractionToReview, isSpreadsheetFile, MAX_PASTE_CHARS, type ExtractionOrigin, type ReviewDocument } from "@/lib/cargo-extract"
import { getExtractionProvider, runExtraction } from "@/lib/cargo-extract-server"
import { importMappingSchema, MAX_IMPORT_ROWS } from "@/lib/cargo-import"
import type { ExtractionErrorCode, ExtractionRequest } from "@/lib/extraction-provider"
import { readWorkbook, SheetError, sheetToText, type WorkbookInfo } from "@/lib/import-sheet"
import { checkDocumentUpload } from "@/lib/import-upload"
import { isPlannable } from "@/lib/cargo-validation"
import { editorOrError } from "@/lib/editor"
import { recordOf } from "@/lib/json"
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
    data: cargoData(project.projectId, parsed.data, { existing: existing.customFields, previous: { stackable: existing.stackable, weightKg: existing.weightKg } }),
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

/** What the import dialog can offer on this server. Reveals whether AI reading is set up, never the key. */
export async function getImportCapabilities(): Promise<{ aiConfigured: boolean; aiLabel: string; model: string } | { error: string }> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }
  const provider = getExtractionProvider()
  return { aiConfigured: provider.isConfigured(), aiLabel: provider.label, model: provider.model }
}

/** Reads an Excel or CSV file and finds the cargo tables in it. Works without any AI key. */
export async function readSpreadsheetFile(formData: FormData): Promise<{ workbook: WorkbookInfo } | { error: string }> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }

  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "Choose an Excel or CSV file." }
  if (!isSpreadsheetFile(file.name)) return { error: "Use an .xlsx or .csv file." }
  try {
    return { workbook: readWorkbook(new Uint8Array(await file.arrayBuffer()), file.name) }
  } catch (error) {
    return { error: error instanceof SheetError ? error.message : "The file could not be read." }
  }
}

export type ExtractOutcome = { document: ReviewDocument } | { error: string; code?: ExtractionErrorCode }

function modeLabelOf(value: unknown): string {
  const mode = typeof value === "string" ? value.toLowerCase() : ""
  return ["sea", "air", "road", "pallet"].includes(mode) ? mode : "sea"
}

/** One reading: checks the provider is set up, runs it once per person and content, and turns the answer into review lines. Nothing is saved. */
async function readWithProvider(
  scope: string,
  origin: ExtractionOrigin,
  request: ExtractionRequest,
  tag?: (document: ReviewDocument) => void,
): Promise<ExtractOutcome> {
  const provider = getExtractionProvider()
  if (!provider.isConfigured()) {
    // The provider itself says what is missing, in words for the planner.
    const result = await provider.extract(request)
    return result.ok ? { error: "AI reading is not available." } : { error: result.error, code: result.code }
  }
  const result = await runExtraction(scope, provider, request)
  if (!result.ok) return { error: result.error, code: result.code }
  const document = extractionToReview(result.raw, origin, { provider: provider.label, model: result.model })
  tag?.(document)
  return { document }
}

/** Reads a photo or PDF of a packing list with the AI provider and returns lines for review. */
export async function extractCargoFromDocument(formData: FormData): Promise<ExtractOutcome> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }

  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "Choose a photo or PDF of the packing list." }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = checkDocumentUpload(documentKind(file.name, file.type), bytes)
  if (!checked.ok) return { error: checked.error }

  const input = checked.kind.kind === "pdf" ? ({ kind: "pdf", bytes } as const) : ({ kind: "image", bytes, mediaType: checked.kind.mediaType } as const)
  return readWithProvider(`${access.user.orgId}:${access.user.id}`, input.kind, { input, modeLabel: modeLabelOf(formData.get("mode")) })
}

/** Reads cargo from pasted text (an email, a quotation, a chat message) and returns lines for review. */
export async function extractCargoFromText(text: string, mode: string): Promise<ExtractOutcome> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }
  const cleaned = typeof text === "string" ? text.trim() : ""
  if (cleaned.length === 0) return { error: "Paste the cargo details first." }
  if (cleaned.length > MAX_PASTE_CHARS) return { error: `That text is longer than ${MAX_PASTE_CHARS.toLocaleString("en-US")} characters. Paste it in parts.` }
  return readWithProvider(`${access.user.orgId}:${access.user.id}`, "text", { input: { kind: "text", text: cleaned, label: "text" }, modeLabel: modeLabelOf(mode) })
}

/**
 * Claude-assisted reading of one spreadsheet sheet, for customer files the column mapper cannot
 * interpret. The file is read again here on the server and only the cell values of the chosen
 * sheet are sent, with their row numbers and cell references.
 */
export async function extractCargoFromSheet(formData: FormData): Promise<ExtractOutcome> {
  const access = await editorOrError()
  if (!access.ok) return { error: access.error }
  const file = formData.get("file")
  const sheetName = formData.get("sheet")
  if (!(file instanceof File) || typeof sheetName !== "string") return { error: "Choose a sheet to read." }
  if (!isSpreadsheetFile(file.name)) return { error: "Use an .xlsx or .csv file." }

  let text: ReturnType<typeof sheetToText>
  try {
    text = sheetToText(new Uint8Array(await file.arrayBuffer()), file.name, sheetName)
  } catch (error) {
    return { error: error instanceof SheetError ? error.message : "The file could not be read." }
  }
  if (!text.ok) return { error: text.error }
  return readWithProvider(
    `${access.user.orgId}:${access.user.id}`,
    "spreadsheet",
    { input: { kind: "text", text: text.text, label: "spreadsheet" }, modeLabel: modeLabelOf(formData.get("mode")) },
    // The reader knows rows, not which sheet they were on; the server does.
    (document) => {
      for (const line of document.lines) line.source = { ...line.source, sheet: sheetName }
    },
  )
}

/** A line the import will accept: a valid cargo line with a real size and weight. */
const importLineSchema = cargoItemInputSchema.superRefine((line, context) => {
  for (const field of ["lengthCm", "widthCm", "heightCm", "weightKg"] as const) {
    if (!(line[field] > 0)) context.addIssue({ code: "custom", message: "Size and weight must be greater than zero.", path: [field] })
  }
  if (line.name.trim() === "") context.addIssue({ code: "custom", message: "Every line needs a description or a mark.", path: ["name"] })
})

export type ImportMode = "append" | "replace"

/** A line to save, with what the review could not settle kept as notes (only for drafts). */
export type ImportRow = CargoItemInput & {
  importNotes?: string[]
  /** The document said nothing about stacking. The line is saved as not stackable and marked so. */
  stackableNotStated?: boolean
  /** The weight is an estimate (an equal share of a total). Fine for a provisional suggestion; confirmed before a load plan. */
  weightEstimate?: { perPieceKg: number; basis: string }
}

const weightEstimateSchema = z.object({ perPieceKg: z.number().finite().positive(), basis: z.string().trim().min(1).max(300) })

const importNotesSchema = z.array(z.string().trim().min(1).max(300)).max(8)

/** An incomplete line is only ever a draft: it needs a name or mark and a quantity, and everything else may still be to do. */
const draftLineSchema = cargoItemInputSchema.superRefine((line, context) => {
  if (line.name.trim() === "") context.addIssue({ code: "custom", message: "A draft still needs a description or a mark.", path: ["name"] })
})

/**
 * Saves reviewed lines. The server checks everything again (access, every line) whatever the
 * screen showed. Replacing needs `confirmReplace`, and the removal and the new lines happen in one
 * transaction, so a failure leaves the project exactly as it was. Existing plans are not rerun: the
 * plan status mechanism sees the cargo changed and marks them out of date.
 *
 * With `allowIncomplete`, a line that is not ready for planning is saved as a draft: what is settled
 * is kept, what is not is left at 0 (the Cargo grid shows it as missing, and a line like that is left
 * out of equipment suggestions and load plans until it is completed), and what the document said
 * about it is stored as notes in the line's existing JSON. Nothing is invented to fill a gap.
 */
export async function importReviewedCargo(
  projectId: string,
  rows: ImportRow[],
  options: { mode?: ImportMode; confirmReplace?: boolean; allowIncomplete?: boolean } = {},
) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  const incomplete = options.allowIncomplete === true
  const parsed = z.array(incomplete ? draftLineSchema : importLineSchema).min(1).max(MAX_IMPORT_ROWS).safeParse(rows)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: incomplete ? "The import has lines that cannot be saved even as drafts. Give each a description or mark and a quantity." : "The import has lines that are incomplete or invalid. Fix or exclude them first.",
    }
  }
  const notes = rows.map((row) => {
    const checked = importNotesSchema.safeParse(row.importNotes ?? [])
    return checked.success ? checked.data : []
  })

  const mode = options.mode ?? "append"
  if (mode === "replace" && options.confirmReplace !== true) {
    return { ok: false as const, error: "Replacing the existing cargo needs your confirmation." }
  }

  try {
    const data = parsed.data.map((row, index) => {
      const sent = rows[index]!
      const estimate = weightEstimateSchema.safeParse(sent.weightEstimate)
      // An estimate is only recorded for the weight it describes; anything else is ignored.
      const weightEstimate = estimate.success && Math.abs(estimate.data.perPieceKg - row.weightKg) < 0.0001 ? estimate.data : undefined
      return cargoData(project.projectId, row, { importNotes: notes[index], stackableNotStated: sent.stackableNotStated === true, weightEstimate })
    })
    const drafts = parsed.data.filter((row) => !isPlannable(row)).length
    if (mode === "replace") {
      const [removed] = await prisma.$transaction([
        prisma.cargoItem.deleteMany({ where: { projectId: project.projectId } }),
        prisma.cargoItem.createMany({ data }),
      ])
      revalidatePath(`/projects/${project.projectId}`)
      return { ok: true as const, count: parsed.data.length, removed: removed.count, drafts }
    }
    await prisma.cargoItem.createMany({ data })
    revalidatePath(`/projects/${project.projectId}`)
    return { ok: true as const, count: parsed.data.length, removed: 0, drafts }
  } catch {
    return { ok: false as const, error: "The lines could not be saved, and nothing was changed. Try again." }
  }
}

/**
 * Confirms the estimated weights of the given lines: they become the planner's own values. Needed before
 * a load plan is calculated with them; an equipment suggestion may use them provisionally.
 */
export async function confirmEstimatedWeights(projectId: string, cargoIds: string[]) {
  const project = await editableProject(projectId)
  if (!project.ok) return project
  const ids = z.array(idSchema).min(1).max(MAX_IMPORT_ROWS).safeParse(cargoIds)
  if (!ids.success) return { ok: false as const, error: "Choose the lines to confirm." }
  const lines = await prisma.cargoItem.findMany({ where: { projectId: project.projectId, id: { in: ids.data } }, select: { id: true, customFields: true } })
  const writes = lines
    .filter((line) => "weightEstimate" in recordOf(line.customFields))
    .map((line) => {
      const kept = { ...recordOf(line.customFields) }
      delete kept.weightEstimate
      return prisma.cargoItem.update({ where: { id: line.id }, data: { customFields: Object.keys(kept).length === 0 ? Prisma.DbNull : (kept as Prisma.InputJsonObject) } })
    })
  if (writes.length > 0) await prisma.$transaction(writes)
  revalidatePath(`/projects/${project.projectId}`)
  return { ok: true as const, confirmed: writes.length }
}

/** Adds lines as they are, for Undo after a delete. Saving a reviewed import is `importReviewedCargo`, which is stricter. */
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

type ExtrasContext = {
  /** The line's stored `customFields`, when it is being updated. */
  existing?: unknown
  importNotes?: string[]
  stackableNotStated?: boolean
  weightEstimate?: { perPieceKg: number; basis: string }
  /** The stored stacking and weight, when updating: changing either is the planner deciding, which retires its marker. */
  previous?: { stackable: boolean; weightKg: number }
}

function cargoData(projectId: string, input: CargoItemInput, context: ExtrasContext = {}) {
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
    customFields: extrasJson(input, context),
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

/**
 * Per-line extras kept in the existing `customFields` JSON column (no migration): the allowed
 * rotations. Anything else already stored on the line is carried over untouched, so data an older
 * version saved there (such as a retired handling-clearance setting) is never read or used, but is not
 * silently destroyed when the line is edited.
 */
function extrasJson(input: CargoItemInput, context: ExtrasContext = {}): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const { existing, importNotes, stackableNotStated, weightEstimate, previous } = context
  const kept = { ...recordOf(existing) }
  const allowed = input.orientation === "CUSTOM" ? formatAllowedRotations(input.allowedRotations) : null
  if (allowed) kept.allowedRotations = allowed
  else delete kept.allowedRotations
  // Notes from an import travel with a draft line only while it is still incomplete. Once it can be planned they have done their job.
  if (isPlannable(input)) delete kept.importNotes
  else if (importNotes && importNotes.length > 0) kept.importNotes = importNotes
  // Stacking the document did not mention: planned as not stackable, and shown as not stated until the planner decides.
  if (stackableNotStated && input.stackable === false) kept.stacking = "not-stated"
  else if (previous && input.stackable !== previous.stackable) delete kept.stacking
  // An estimated weight stays marked until it is confirmed or the planner enters another weight.
  if (weightEstimate) kept.weightEstimate = weightEstimate
  else if (previous && Math.abs(input.weightKg - previous.weightKg) > 0.0001) delete kept.weightEstimate
  return Object.keys(kept).length === 0 ? Prisma.DbNull : (kept as Prisma.InputJsonObject)
}

function mappingJson(mapping: z.infer<typeof importMappingSchema>): Prisma.InputJsonObject {
  return {
    lengthUnit: mapping.lengthUnit,
    weightUnit: mapping.weightUnit,
    columns: mapping.columns,
  }
}
