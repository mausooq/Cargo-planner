import * as XLSX from "xlsx"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    cargoItem: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/cargo-extract-server", async (original) => ({
  ...(await original<typeof import("@/lib/cargo-extract-server")>()),
  getExtractionProvider: vi.fn(),
  runExtraction: vi.fn(),
}))

import { cargoItemInputSchema } from "@compass/domain"
import {
  extractCargoFromDocument,
  extractCargoFromSheet,
  extractCargoFromText,
  getImportCapabilities,
  importCargoRows,
  importReviewedCargo,
  readSpreadsheetFile,
} from "@/app/actions/cargo"
import { cargoPreset } from "@/lib/cargo-defaults"
import type { RawExtraction } from "@/lib/cargo-extract"
import { getExtractionProvider, runExtraction } from "@/lib/cargo-extract-server"
import type { ExtractionProvider } from "@/lib/extraction-provider"
import { cargoSignature, planStaleness } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

const requireUserMock = vi.mocked(requireUser)
const db = vi.mocked(prisma, true)
const providerMock = vi.mocked(getExtractionProvider)
const runMock = vi.mocked(runExtraction)

const asUser = (role: "ADMIN" | "PLANNER" | "VIEWER" = "PLANNER") =>
  requireUserMock.mockResolvedValue({ id: "u1", role, orgId: "org-1", orgName: "Compass", name: "N", email: "e@x" } as never)

const line = (overrides = {}) => ({ ...cargoPreset("BOX"), sku: "C-1", name: "Crate", lengthCm: 120, widthCm: 80, heightCm: 60, weightKg: 150, quantity: 10, ...overrides })

const answer: RawExtraction = {
  summary: "A list.",
  language: "English",
  lines: [
    {
      reference: "C-1",
      description: "Crate",
      descriptionEnglish: null,
      length: null,
      width: null,
      height: null,
      combinedSize: "120 x 80 x 60 cm",
      sizeUnit: null,
      quantity: "10",
      weightPerPiece: "150 kg",
      lineWeight: null,
      weightUnclear: null,
      weightUnit: null,
      weightKind: null,
      shape: null,
      stackable: null,
      floorOnly: null,
      orientationRestriction: null,
      consignment: null,
      destination: null,
      hazardClass: null,
      handling: null,
      clearanceCm: null,
      source: { page: null, row: "4", quote: "10 crates" },
      uncertain: [],
    },
  ],
  documentTotals: null,
  warnings: [],
  unreadable: [],
  complete: true,
}

function fakeProvider(configured = true): ExtractionProvider {
  return {
    id: "fake",
    label: "Fake reader",
    model: "fake-1",
    isConfigured: () => configured,
    extract: vi.fn(async () => ({ ok: false as const, code: "not_configured" as const, error: "AI reading is not set up on this server. Ask your admin to add ANTHROPIC_API_KEY." })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser()
  db.project.findFirst.mockResolvedValue({ id: "p1" } as never)
  db.$transaction.mockImplementation((async (operations: unknown[]) => Promise.all(operations)) as never)
  db.cargoItem.deleteMany.mockResolvedValue({ count: 3 } as never)
  db.cargoItem.createMany.mockResolvedValue({ count: 1 } as never)
})

describe("saving reviewed lines", () => {
  it("appends without touching existing cargo", async () => {
    const result = await importReviewedCargo("p1", [line()])
    expect(result).toEqual({ ok: true, count: 1, removed: 0 })
    expect(db.cargoItem.deleteMany).not.toHaveBeenCalled()
    expect(db.cargoItem.createMany).toHaveBeenCalledOnce()
    expect(db.cargoItem.createMany.mock.calls[0]![0]!.data).toMatchObject([{ projectId: "p1", name: "Crate", lengthCm: 120, weightKg: 150, quantity: 10 }])
  })

  it("refuses to replace unless the planner confirmed it, and changes nothing", async () => {
    const result = await importReviewedCargo("p1", [line()], { mode: "replace" })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("confirmation") })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.cargoItem.deleteMany).not.toHaveBeenCalled()
  })

  it("replaces inside one transaction, removing the project's lines and adding the new ones", async () => {
    const result = await importReviewedCargo("p1", [line()], { mode: "replace", confirmReplace: true })
    expect(result).toEqual({ ok: true, count: 1, removed: 3 })
    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(db.cargoItem.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p1" } })
    expect(db.cargoItem.createMany).toHaveBeenCalledOnce()
  })

  it("reports a failed replace as a failure, with nothing claimed to have changed", async () => {
    db.$transaction.mockRejectedValue(new Error("disk full"))
    const result = await importReviewedCargo("p1", [line()], { mode: "replace", confirmReplace: true })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("nothing was changed") })
  })

  it("rejects incomplete or invalid lines whatever the screen sent", async () => {
    for (const bad of [line({ weightKg: 0 }), line({ lengthCm: 0 }), line({ name: "  " }), line({ quantity: 0 }), line({ heightCm: -1 })]) {
      const result = await importReviewedCargo("p1", [line(), bad])
      expect(result.ok).toBe(false)
    }
    expect(await importReviewedCargo("p1", [])).toMatchObject({ ok: false })
    expect(db.cargoItem.createMany).not.toHaveBeenCalled()
  })

  it("is refused for viewers and for projects of another organization", async () => {
    asUser("VIEWER")
    expect((await importReviewedCargo("p1", [line()])).ok).toBe(false)
    asUser("PLANNER")
    db.project.findFirst.mockResolvedValue(null as never)
    expect((await importReviewedCargo("p1", [line()])).ok).toBe(false)
    expect(db.project.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "p1", orgId: "org-1" } }))
    expect(db.cargoItem.createMany).not.toHaveBeenCalled()
  })

  it("keeps the project's clearance by default and stores a stated override", async () => {
    await importReviewedCargo("p1", [line(), line({ name: "Crate 2", clearanceCm: 5 })])
    const rows = db.cargoItem.createMany.mock.calls[0]![0]!.data as { customFields: unknown }[]
    // Inheriting stores nothing; an explicit override is stored in the line's own settings.
    expect(rows[0]!.customFields).not.toEqual(expect.objectContaining({ clearanceCm: expect.anything() }))
    expect(JSON.stringify(rows[1]!.customFields)).toContain("5")
  })

  it("still lets Undo restore a line exactly as it was, even one that is not complete yet", async () => {
    expect(await importCargoRows("p1", [line({ weightKg: 0, name: "" })])).toEqual({ ok: true, count: 1 })
  })

  it("the cargo it creates is valid cargo", () => {
    expect(cargoItemInputSchema.safeParse(line()).success).toBe(true)
  })
})

describe("plans after an import", () => {
  const stored = { id: "a", lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 10, quantity: 1, shape: "BOX", orientation: "ANY", stackable: true, bottomOnly: false, priority: 0, destinationStop: 1 }
  const plan = { createdAt: new Date("2026-01-01"), settings: { cargoSignature: cargoSignature([stored]), clearanceCm: 0 } }

  it("an up-to-date plan is marked out of date once lines are added", () => {
    expect(planStaleness(plan, [stored], 0)).toBeNull()
    expect(planStaleness(plan, [stored, { ...stored, id: "b" }], 0)).toBe("cargo")
  })

  it("and once the lines are replaced", () => {
    expect(planStaleness(plan, [{ ...stored, id: "z" }], 0)).toBe("cargo")
  })

  it("the import never reruns the packing", async () => {
    await importReviewedCargo("p1", [line()])
    expect(Object.keys(db)).not.toContain("plan")
  })
})

describe("reading a spreadsheet needs no AI key", () => {
  const workbook = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Description", "Qty", "L", "W", "H", "Weight"], ["Crate", 2, 120, 80, 60, 150]]), "Sheet1")
    return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer)
  }
  const form = (bytes: Uint8Array, name: string) => {
    const data = new FormData()
    data.set("file", new File([new Uint8Array(bytes)], name))
    return data
  }

  it("reads the workbook without touching the provider", async () => {
    const result = await readSpreadsheetFile(form(workbook(), "list.xlsx"))
    expect("workbook" in result && result.workbook.sheets[0]!.tables[0]!.confident).toBe(true)
    expect(providerMock).not.toHaveBeenCalled()
  })

  it("refuses the wrong file type, a damaged file and a viewer", async () => {
    expect(await readSpreadsheetFile(form(workbook(), "list.pdf"))).toMatchObject({ error: expect.stringContaining(".xlsx or .csv") })
    expect(await readSpreadsheetFile(form(new Uint8Array([1, 2, 3, 4, 5]), "list.xlsx"))).toHaveProperty("error")
    asUser("VIEWER")
    expect(await readSpreadsheetFile(form(workbook(), "list.xlsx"))).toHaveProperty("error")
  })

  it("sends only the chosen sheet's values to the reader, with row references, and tags the sheet", async () => {
    providerMock.mockReturnValue(fakeProvider())
    runMock.mockResolvedValue({ ok: true, raw: answer, provider: "fake", model: "fake-1" })
    const data = form(workbook(), "list.xlsx")
    data.set("sheet", "Sheet1")
    const result = await extractCargoFromSheet(data)
    expect(runMock).toHaveBeenCalledOnce()
    const request = runMock.mock.calls[0]![2]
    expect(request.input).toMatchObject({ kind: "text", label: "spreadsheet" })
    expect(request.input.kind === "text" ? request.input.text : "").toContain("Row 2 | A2: Crate")
    expect("document" in result && result.document.lines[0]!.source.sheet).toBe("Sheet1")
    expect("document" in result && result.document.origin).toBe("spreadsheet")
  })
})

describe("reading pasted text", () => {
  it("returns lines for review and saves nothing", async () => {
    providerMock.mockReturnValue(fakeProvider())
    runMock.mockResolvedValue({ ok: true, raw: answer, provider: "fake", model: "fake-1" })
    const result = await extractCargoFromText("10 crates 120 x 80 x 60 cm 150 kg", "sea")
    expect(result).toMatchObject({ document: { origin: "text", reader: { provider: "Fake reader", model: "fake-1" } } })
    expect(runMock.mock.calls[0]![0]).toBe("org-1:u1")
    expect(db.cargoItem.createMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("explains plainly when AI reading is not set up", async () => {
    const provider = fakeProvider(false)
    providerMock.mockReturnValue(provider)
    const result = await extractCargoFromText("10 crates", "sea")
    expect(result).toMatchObject({ code: "not_configured", error: expect.stringContaining("ANTHROPIC_API_KEY") })
    expect(runMock).not.toHaveBeenCalled()
  })

  it("passes a failed reading on and changes no cargo", async () => {
    providerMock.mockReturnValue(fakeProvider())
    runMock.mockResolvedValue({ ok: false, code: "rate_limit", error: "Claude is busy right now (rate limit). Wait a minute and try again." })
    expect(await extractCargoFromText("10 crates", "sea")).toEqual({ error: "Claude is busy right now (rate limit). Wait a minute and try again.", code: "rate_limit" })
    expect(db.cargoItem.createMany).not.toHaveBeenCalled()
  })

  it("rejects empty and over-long text and a viewer", async () => {
    providerMock.mockReturnValue(fakeProvider())
    expect(await extractCargoFromText("   ", "sea")).toHaveProperty("error")
    expect(await extractCargoFromText("x".repeat(30_001), "sea")).toMatchObject({ error: expect.stringContaining("longer than") })
    asUser("VIEWER")
    expect(await extractCargoFromText("10 crates", "sea")).toHaveProperty("error")
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe("reading a photo or PDF", () => {
  const form = (bytes: Uint8Array, name: string, type: string) => {
    const data = new FormData()
    data.set("file", new File([new Uint8Array(bytes)], name, { type }))
    data.set("mode", "air")
    return data
  }
  const pdf = new TextEncoder().encode("%PDF-1.4\n<< /Type /Pages /Count 1 >> << /Type /Page >>")
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

  it("sends a real PDF and a real image to the reader", async () => {
    providerMock.mockReturnValue(fakeProvider())
    runMock.mockResolvedValue({ ok: true, raw: answer, provider: "fake", model: "fake-1" })
    expect(await extractCargoFromDocument(form(pdf, "list.pdf", "application/pdf"))).toHaveProperty("document")
    expect(await extractCargoFromDocument(form(png, "shot.png", "image/png"))).toHaveProperty("document")
    expect(runMock.mock.calls.map((call) => call[2].input.kind)).toEqual(["pdf", "image"])
    expect(runMock.mock.calls[0]![2].modeLabel).toBe("air")
  })

  it("refuses files that are not what they say, are empty, oversized or unsupported, before any request", async () => {
    providerMock.mockReturnValue(fakeProvider())
    expect(await extractCargoFromDocument(form(new TextEncoder().encode("not a pdf"), "x.pdf", "application/pdf"))).toMatchObject({ error: expect.stringContaining("not one") })
    expect(await extractCargoFromDocument(form(new Uint8Array(0), "x.pdf", "application/pdf"))).toMatchObject({ error: expect.stringContaining("empty") })
    expect(await extractCargoFromDocument(form(new Uint8Array(11 * 1024 * 1024), "x.pdf", "application/pdf"))).toMatchObject({ error: expect.stringContaining("10 MB") })
    expect(await extractCargoFromDocument(form(pdf, "x.docx", "application/msword"))).toMatchObject({ error: expect.stringContaining("PDF, JPG") })
    expect(await extractCargoFromDocument(form(new TextEncoder().encode("%PDF-1.4 /Encrypt"), "x.pdf", "application/pdf"))).toMatchObject({ error: expect.stringContaining("password") })
    expect(runMock).not.toHaveBeenCalled()
  })

  it("refuses a PDF with more pages than the limit instead of cutting it short", async () => {
    const long = new TextEncoder().encode(`%PDF-1.4\n<< /Type /Pages /Count 80 >>`)
    expect(await extractCargoFromDocument(form(long, "long.pdf", "application/pdf"))).toMatchObject({ error: expect.stringContaining("up to 30 can be read") })
  })
})

describe("what the dialog may know about the server", () => {
  it("says whether AI is configured and which model, and nothing secret", async () => {
    providerMock.mockReturnValue(fakeProvider())
    const result = await getImportCapabilities()
    expect(result).toEqual({ aiConfigured: true, aiLabel: "Fake reader", model: "fake-1" })
    expect(JSON.stringify(result)).not.toMatch(/sk-|KEY/)
  })
})
