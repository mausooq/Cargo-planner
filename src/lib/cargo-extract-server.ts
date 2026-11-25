import { createHash } from "node:crypto"
import tls from "node:tls"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { EXTRACTION_SYSTEM_PROMPT, extractionUserPrompt, rawExtractionSchema } from "@/lib/cargo-extract"
import type { ExtractionProvider, ExtractionRequest, ExtractionResult } from "@/lib/extraction-provider"

/**
 * Server only: reads documents with an AI provider. Import this from Server Actions, never from
 * client components. Nothing here is sent to the browser: the key is read from the environment and
 * stays on the server, and document contents are never written to the logs.
 */

const DEFAULT_MODEL = "claude-sonnet-5-5"
const DEFAULT_TIMEOUT_MS = 120_000

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
  } catch {
    console.error("Could not load the operating system's certificates.")
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

type ParseClient = Pick<Anthropic, "beta">

export type AnthropicProviderOptions = {
  /** For tests: supplies the client instead of creating one from the environment. */
  clientFactory?: () => ParseClient
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): ExtractionProvider {
  const model = process.env.COMPASS_AI_MODEL?.trim() || DEFAULT_MODEL
  return {
    id: "anthropic",
    label: "Claude (Anthropic)",
    model,
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY?.trim()),

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      if (!process.env.ANTHROPIC_API_KEY?.trim() && !options.clientFactory) {
        return {
          ok: false,
          code: "not_configured",
          error:
            "AI reading is not set up on this server. Ask your admin to add ANTHROPIC_API_KEY. Excel and CSV packing lists can still be imported by column.",
        }
      }

      const timeout = Number(process.env.COMPASS_AI_TIMEOUT_MS) > 0 ? Number(process.env.COMPASS_AI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
      trustSystemCertificates()
      // Reads ANTHROPIC_API_KEY from the environment. One retry for a connection hiccup, none for the rest.
      const client = options.clientFactory ? options.clientFactory() : new Anthropic({ timeout, maxRetries: 1 })

      const { input } = request
      const prompt = extractionUserPrompt(input.kind === "text" ? input.label : input.kind, request.modeLabel, input.kind === "text" ? input.text : undefined)
      const content =
        input.kind === "text"
          ? [{ type: "text" as const, text: prompt }]
          : [
              input.kind === "pdf"
                ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(input.bytes).toString("base64") } } as const)
                : ({ type: "image", source: { type: "base64", media_type: input.mediaType, data: Buffer.from(input.bytes).toString("base64") } } as const),
              { type: "text" as const, text: prompt },
            ]

      try {
        const response = await client.beta.messages.parse({
          model,
          max_tokens: 16000,
          // If the model declines a request, the API retries it on a fallback model in the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: EXTRACTION_SYSTEM_PROMPT,
          output_config: { effort: "medium", format: betaZodOutputFormat(rawExtractionSchema) },
          messages: [{ role: "user", content }],
        })

        if (response.stop_reason === "refusal") {
          return { ok: false, code: "refused", error: "Claude declined to read this document. Enter the cargo by hand or import an Excel file." }
        }
        if (response.stop_reason === "max_tokens") {
          return { ok: false, code: "too_long", error: "This document is too long to read in one go. Split it into smaller files, or import an Excel file." }
        }
        // The answer is checked against the schema again here, whatever the SDK already did.
        const checked = rawExtractionSchema.safeParse(response.parsed_output)
        if (!checked.success) {
          return { ok: false, code: "invalid_response", error: "Could not make sense of the answer. Try again, or use a clearer file. Nothing was changed." }
        }
        return { ok: true, raw: checked.data, provider: "anthropic", model }
      } catch (error) {
        return mapError(error)
      }
    },
  }
}

function mapError(error: unknown): ExtractionResult {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { ok: false, code: "auth", error: "The Claude API key was not accepted. Ask your admin to check ANTHROPIC_API_KEY." }
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { ok: false, code: "rate_limit", error: "Claude is busy right now (rate limit). Wait a minute and try again." }
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { ok: false, code: "bad_request", error: "The configured Claude model was not found. Ask your admin to check COMPASS_AI_MODEL." }
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("Cargo document rejected by the Claude API.")
    return { ok: false, code: "bad_request", error: "Claude could not open this file. Check that it is a normal PDF or image and not password protected." }
  }
  // A timeout is a kind of connection error, so it is checked first.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { ok: false, code: "timeout", error: "Claude took too long to answer. Try again, or use a smaller file." }
  }
  if (error instanceof Anthropic.APIConnectionError) {
    console.error("Could not connect to the Claude API.")
    if (isCertificateError(error)) {
      return { ok: false, code: "certificate", error: "The server's security software or firewall blocked the secure connection to Claude. Ask your admin to allow api.anthropic.com." }
    }
    return { ok: false, code: "connection", error: "Could not reach Claude. Check the server's internet connection and try again." }
  }
  if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${error.status ?? ""}`.trim())
    return { ok: false, code: "unavailable", error: "Claude could not read the document just now. Try again in a moment." }
  }
  console.error("Unexpected error while reading a document.")
  return { ok: false, code: "unavailable", error: "The document could not be read just now. Try again in a moment." }
}

/** A provider that is named in the configuration but not built yet. Every request says so plainly. */
function notAvailable(id: string): ExtractionProvider {
  return {
    id,
    label: id,
    model: "",
    isConfigured: () => false,
    extract: async () => ({
      ok: false,
      code: "not_configured",
      error: `The AI provider “${id}” is not available in this version. Set COMPASS_AI_PROVIDER=anthropic, or leave it unset.`,
    }),
  }
}

/** The provider chosen by COMPASS_AI_PROVIDER (default "anthropic"). The one place a new provider is added. */
export function getExtractionProvider(): ExtractionProvider {
  const id = (process.env.COMPASS_AI_PROVIDER?.trim() || "anthropic").toLowerCase()
  if (id === "anthropic") return createAnthropicProvider()
  return notAvailable(id)
}

export function documentReadingConfigured(): boolean {
  return getExtractionProvider().isConfigured()
}

// ---- one request at a time per document ---------------------------------------------------------

const inFlight = new Map<string, Promise<ExtractionResult>>()

function fingerprint(scope: string, request: ExtractionRequest): string {
  const hash = createHash("sha256")
  hash.update(scope)
  hash.update("\0")
  hash.update(request.modeLabel)
  hash.update("\0")
  hash.update(request.input.kind)
  hash.update("\0")
  if (request.input.kind === "text") hash.update(request.input.text)
  else hash.update(request.input.bytes)
  return hash.digest("hex")
}

/**
 * Runs a reading, and joins one already running for the same person and the same content instead of
 * paying for a second. A double click or a repeated submit therefore costs one request.
 */
export function runExtraction(scope: string, provider: ExtractionProvider, request: ExtractionRequest): Promise<ExtractionResult> {
  const key = fingerprint(`${provider.id}:${provider.model}:${scope}`, request)
  const running = inFlight.get(key)
  if (running) return running
  const started = provider.extract(request).finally(() => inFlight.delete(key))
  inFlight.set(key, started)
  return started
}
