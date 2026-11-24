import tls from "node:tls"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import {
  cargoExtractionSchema,
  EXTRACTION_SYSTEM_PROMPT,
  extractionToCargo,
  extractionUserPrompt,
  type DocumentKind,
  type ExtractedCargo,
} from "@/lib/cargo-extract"

/** Server only: sends the document to Claude. Import this from Server Actions, never from client components. */

const DEFAULT_MODEL = "claude-sonnet-5-5"

let systemCertificatesAdded = false

/**
 * Makes Node trust the certificates the operating system trusts, as browsers do. Office PCs often
 * run antivirus or a firewall that inspects HTTPS with its own root certificate; that root is in
 * the OS store but not in Node's built-in list, so without this the call to Claude fails with
 * "self-signed certificate in certificate chain". Certificate checking itself stays on.
 * Set COMPASS_SYSTEM_CA=0 to keep Node's built-in list only.
 */
function trustSystemCertificates() {
  if (systemCertificatesAdded) return
  systemCertificatesAdded = true
  if (process.env.COMPASS_SYSTEM_CA === "0") return
  try {
    // Both functions are recent additions to Node (and missing from its older type definitions).
    // Where they do not exist, Node's own list is used as before.
    const store = tls as typeof tls & {
      getCACertificates?: (type: "default" | "system") => string[]
      setDefaultCACertificates?: (certificates: string[]) => void
    }
    if (typeof store.getCACertificates !== "function" || typeof store.setDefaultCACertificates !== "function") return
    store.setDefaultCACertificates([...store.getCACertificates("default"), ...store.getCACertificates("system")])
  } catch (error) {
    console.error("Could not load the operating system's certificates:", error)
  }
}

const CERTIFICATE_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
])

function isCertificateError(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : ""
  return CERTIFICATE_ERRORS.has(code)
}

export type ReadDocumentResult = { ok: true; cargo: ExtractedCargo } | { ok: false; error: string }

export function documentReadingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export async function readCargoDocument(input: {
  bytes: Uint8Array
  document: DocumentKind
  modeLabel: string
}): Promise<ReadDocumentResult> {
  if (!documentReadingConfigured()) {
    return {
      ok: false,
      error: "Reading photos and PDFs is not set up on this server. Ask your admin to add ANTHROPIC_API_KEY, or import an Excel file instead.",
    }
  }

  trustSystemCertificates()
  // Reads ANTHROPIC_API_KEY from the environment.
  const client = new Anthropic({ timeout: 120_000, maxRetries: 1 })
  const data = Buffer.from(input.bytes).toString("base64")
  const file =
    input.document.kind === "pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: input.document.mediaType, data } } as const)

  try {
    const response = await client.beta.messages.parse({
      model: process.env.COMPASS_AI_MODEL?.trim() || DEFAULT_MODEL,
      max_tokens: 16000,
      // If the model declines a request, the API retries it on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: EXTRACTION_SYSTEM_PROMPT,
      output_config: { effort: "medium", format: betaZodOutputFormat(cargoExtractionSchema) },
      messages: [{ role: "user", content: [file, { type: "text", text: extractionUserPrompt(input.modeLabel) }] }],
    })

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "Claude declined to read this document. Enter the cargo by hand or import an Excel file." }
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "This document is too long to read in one go. Split it, or import an Excel file instead." }
    }
    const parsed = response.parsed_output
    if (!parsed) return { ok: false, error: "Could not make sense of the answer. Try again, or use a clearer photo." }
    return { ok: true, cargo: extractionToCargo(parsed) }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "The Claude API key was not accepted. Ask your admin to check ANTHROPIC_API_KEY." }
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Claude is busy right now. Wait a minute and try again." }
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error("Cargo document rejected by the Claude API:", error.message)
      return { ok: false, error: "Claude could not open this file. Check that it is a normal PDF or image and not password protected." }
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.error("Could not connect to the Claude API:", error.message, error.cause ?? "")
      if (isCertificateError(error)) {
        return {
          ok: false,
          error: "The server's security software or firewall blocked the secure connection to Claude. Ask your admin to allow api.anthropic.com.",
        }
      }
      return { ok: false, error: "Could not reach Claude. Check the server's internet connection and try again." }
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Claude API error ${error.status}:`, error.message)
      return { ok: false, error: "Claude could not read the document just now. Try again in a moment." }
    }
    throw error
  }
}
