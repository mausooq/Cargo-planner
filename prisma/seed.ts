import { Prisma, PrismaClient } from "@prisma/client"
import { equipmentSeedSchema, type EquipmentMode } from "@compass/domain"
import bcrypt from "bcryptjs"
import path from "node:path"
import * as XLSX from "xlsx"
import { DEMO_ACCOUNTS, DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_PASSWORD } from "../src/lib/demo-accounts"
import { equipmentPhysics } from "../src/lib/equipment-defaults"
import { findCargoPlannerOverlay, loadCargoPlannerOverlays } from "../src/lib/cargo-planner-overlay"
import { emptyContour, uldContour } from "../src/lib/uld-contour"
import { indexUldByName, normalizeUldName, readUldMaster, type UldMasterRow } from "../src/lib/uld-master"

const SHEET_MODE = {
  Sea: "SEA",
  Air: "AIR",
  Land: "ROAD",
  Pallets: "PALLET",
} as const satisfies Record<string, EquipmentMode>

const EXPECTED_COUNTS: Record<EquipmentMode, number> = {
  SEA: 20,
  AIR: 48,
  ROAD: 27,
  PALLET: 4,
}

const EXPECTED_HEADERS = ["ID", "Name", "Size", "Length (CM)", "Width (CM)", "Height (CM)"]

const prisma = new PrismaClient()

async function main() {
  const workbookPath = path.join(process.cwd(), "Equipment_List_and_Dimensions.xlsx")
  const workbook = XLSX.readFile(workbookPath)
  const uldMaster = indexUldByName(readUldMaster())
  const overlays = loadCargoPlannerOverlays()
  const rows = readWorkbook(workbook, uldMaster, overlays)

  const org = await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: { name: DEMO_ORG_NAME },
    create: { id: DEMO_ORG_ID, name: DEMO_ORG_NAME },
  })

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10)
  for (const account of DEMO_ACCOUNTS) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        role: account.role,
        passwordHash,
        orgId: org.id,
      },
      create: {
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash,
        orgId: org.id,
      },
    })
  }

  for (const row of rows) {
    await prisma.equipmentType.upsert({
      where: {
        externalId_mode: {
          externalId: row.externalId,
          mode: row.mode,
        },
      },
      update: row,
      create: row,
    })
  }

  const counts = await prisma.equipmentType.groupBy({
    by: ["mode"],
    where: { orgId: null, isCustom: false },
    _count: { _all: true },
  })

  const summary = Object.fromEntries(counts.map((entry) => [entry.mode, entry._count._all]))
  for (const mode of Object.keys(EXPECTED_COUNTS) as EquipmentMode[]) {
    if (summary[mode] !== EXPECTED_COUNTS[mode]) {
      throw new Error(`Expected ${EXPECTED_COUNTS[mode]} ${mode} types, found ${summary[mode] ?? 0}.`)
    }
  }

  console.log(`Seeded ${rows.length} equipment types.`)
  for (const mode of Object.keys(EXPECTED_COUNTS) as EquipmentMode[]) {
    console.log(`  ${mode}: ${summary[mode]}`)
  }
  console.log(`Demo org: ${DEMO_ORG_NAME}`)
  for (const account of DEMO_ACCOUNTS) {
    console.log(`  ${account.role} ${account.email} / ${DEMO_PASSWORD}`)
  }
}

function readWorkbook(
  workbook: XLSX.WorkBook,
  uldMaster: Map<string, UldMasterRow>,
  overlays: ReturnType<typeof loadCargoPlannerOverlays>,
) {
  const rows = []
  for (const [sheetName, mode] of Object.entries(SHEET_MODE)) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) throw new Error(`Workbook is missing the ${sheetName} sheet.`)
    const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    })
    assertHeaders(sheetName, table[0])
    for (let index = 1; index < table.length; index += 1) {
      const parsed = parseRow(sheetName, mode, index + 1, table[index], uldMaster, overlays)
      if (parsed) rows.push(parsed)
    }
  }
  return rows
}

function assertHeaders(sheetName: string, header: unknown[] | undefined) {
  if (!header) throw new Error(`${sheetName} has no header row.`)
  for (let index = 0; index < EXPECTED_HEADERS.length; index += 1) {
    if (header[index] !== EXPECTED_HEADERS[index]) {
      throw new Error(
        `${sheetName} column ${index + 1} is "${String(header[index])}", expected "${EXPECTED_HEADERS[index]}".`,
      )
    }
  }
}

function parseRow(
  sheetName: string,
  mode: EquipmentMode,
  excelRow: number,
  row: unknown[] | undefined,
  uldMaster: Map<string, UldMasterRow>,
  overlays: ReturnType<typeof loadCargoPlannerOverlays>,
) {
  if (!row || row.every((cell) => cell === null || cell === "")) return null
  const externalId = asId(row[0])
  const name = asText(row[1])
  const sizeLabel = asText(row[2])
  const lengthCm = asNumber(row[3])
  const widthCm = asNumber(row[4])
  const heightCm = asNumber(row[5])
  if (!externalId || !name || lengthCm === null || widthCm === null) {
    throw new Error(`${sheetName} row ${excelRow} is missing an id, name, length, or width.`)
  }

  const master = mode === "AIR" ? uldMaster.get(normalizeUldName(name)) : undefined
  if (mode === "AIR" && !master) {
    throw new Error(`${sheetName} row ${excelRow} (${name}) has no matching ULD master row.`)
  }

  const overlay = findCargoPlannerOverlay(name, overlays)
  const physics = equipmentPhysics({
    mode,
    externalId,
    name,
    lengthCm: overlay?.innerLengthCm ?? master?.innerLengthCm ?? lengthCm,
    widthCm: overlay?.innerWidthCm ?? master?.innerWidthCm ?? widthCm,
    heightCm: overlay?.innerHeightCm ?? (master ? master.innerHeightCm : heightCm),
  })
  const contour = overlay?.contour ?? uldContour(name) ?? emptyContour()

  const record = {
    externalId,
    mode,
    name,
    code: toCode(name, externalId),
    sizeLabel: overlay
      ? `${trimNum(overlay.innerLengthCm)} x ${trimNum(overlay.innerWidthCm)} x ${trimNum(overlay.innerHeightCm)} CM`
      : (master?.sizeLabel ?? sizeLabel),
    innerLengthCm: overlay?.innerLengthCm ?? master?.innerLengthCm ?? lengthCm,
    innerWidthCm: overlay?.innerWidthCm ?? master?.innerWidthCm ?? widthCm,
    innerHeightCm: overlay?.innerHeightCm ?? master?.innerHeightCm ?? physics.innerHeightCm,
    heightOpen: master?.heightOpen ?? physics.heightOpen,
    maxPayloadKg: overlay?.maxPayloadKg ?? master?.maxPayloadKg ?? physics.maxPayloadKg,
    tareKg: overlay?.tareKg ?? master?.tareKg ?? physics.tareKg,
    floors: physics.floors,
    axleGroups: physics.axleGroups,
    costPerUnit: physics.costPerUnit,
    isCustom: false,
    extendable: physics.extendable,
    maxExtendedLengthCm: physics.maxExtendedLengthCm,
    oogClass: physics.oogClass,
    notes: overlay
      ? [master?.notes ?? physics.notes, "Details aligned to the Cargo-Planner equipment library."]
          .filter(Boolean)
          .join(" ")
      : (master?.notes ?? physics.notes),
    contour,
    doorWidthCm: overlay?.doorWidthCm ?? null,
    doorHeightCm: overlay?.doorHeightCm ?? null,
    orgId: null,
  }

  const parsed = equipmentSeedSchema.safeParse(record)
  if (!parsed.success) {
    throw new Error(`${sheetName} row ${excelRow} (${name}) failed validation: ${parsed.error.message}`)
  }
  return {
    ...parsed.data,
    axleGroups: axleJson(parsed.data.axleGroups),
    contour: parsed.data.contour ?? contour,
  }
}

function trimNum(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function toCode(name: string, externalId: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return `${slug}-${externalId}`
}

function axleJson(
  groups: { name: string; positionFromFrontCm: number; maxKg: number }[],
): Prisma.InputJsonValue {
  return groups.map((group) => {
    const entry: Prisma.InputJsonObject = {
      name: group.name,
      positionFromFrontCm: group.positionFromFrontCm,
      maxKg: group.maxKg,
    }
    return entry
  })
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value.trim()) return value.trim()
  return null
}

function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value.trim()) return value.trim()
  return null
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
