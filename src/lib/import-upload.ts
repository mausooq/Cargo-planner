import { inspectPdf, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, sniffDocument, type DocumentKind } from "@/lib/cargo-extract"

/**
 * Checks an uploaded photo or PDF before it is read: what it really is (judged from its content, not
 * its name), how big it is, and for a PDF how many pages and whether it is password protected.
 * Nothing is opened or run. Server only in practice, but it has no server dependencies.
 */

export const DEFAULT_MAX_PDF_PAGES = 30

export function maxPdfPages(): number {
  const value = Number(process.env.COMPASS_AI_MAX_PDF_PAGES)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_PDF_PAGES
}

export type UploadCheck = { ok: true; kind: DocumentKind } | { ok: false; error: string }

export function checkDocumentUpload(claimed: DocumentKind | null, bytes: Uint8Array): UploadCheck {
  if (!claimed) return { ok: false, error: "Use a PDF, JPG, PNG or WebP file. For spreadsheets, use an .xlsx or .csv file." }
  if (bytes.length === 0) return { ok: false, error: "That file is empty." }
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, error: "That file is over 10 MB. Use a smaller scan or fewer pages." }

  const actual = sniffDocument(bytes)
  if (claimed.kind === "pdf") {
    if (actual !== "pdf") return { ok: false, error: "That file is named like a PDF but is not one." }
    const { pages, encrypted } = inspectPdf(bytes)
    if (encrypted) return { ok: false, error: "That PDF is password protected. Remove the password and try again." }
    const limit = maxPdfPages()
    if (pages > limit) {
      return { ok: false, error: `That PDF has about ${pages} pages; up to ${limit} can be read at once. Split it and import the parts one after another. Nothing is cut off silently.` }
    }
    return { ok: true, kind: claimed }
  }
  if (actual === null || actual === "pdf") return { ok: false, error: "That file is named like an image but is not a picture Compass can read." }
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "That image is over 5 MB. Save it smaller, or take a screenshot of the list instead." }
  // Trust the content over the name: a PNG saved as .jpg is read as the PNG it is.
  return { ok: true, kind: { kind: "image", mediaType: actual } }
}
