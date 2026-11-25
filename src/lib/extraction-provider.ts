import type { DocumentImageType, RawExtraction } from "@/lib/cargo-extract"

/**
 * The contract between the import workflow and whatever reads a document. The workflow, the
 * extraction schema and the review screen depend only on this file, so another provider (an
 * internal model on a workstation, for example) can be added by implementing `ExtractionProvider`
 * and registering it in cargo-extract-server.ts, without touching anything else. Only the Claude
 * provider exists today.
 */

export type ExtractionInput =
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "image"; bytes: Uint8Array; mediaType: DocumentImageType }
  /** Pasted text, or one spreadsheet sheet written out as text. */
  | { kind: "text"; text: string; label: "text" | "spreadsheet" }

export type ExtractionRequest = {
  input: ExtractionInput
  /** Sea, air, road or pallet: tells the reader what kind of packages matter. */
  modeLabel: string
}

export type ExtractionErrorCode =
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "connection"
  | "certificate"
  | "bad_request"
  | "refused"
  | "too_long"
  | "invalid_response"
  | "unavailable"

export type ExtractionResult =
  | { ok: true; raw: RawExtraction; provider: string; model: string }
  | { ok: false; code: ExtractionErrorCode; error: string }

export interface ExtractionProvider {
  /** Short stable name, such as "anthropic". */
  readonly id: string
  /** Name shown to people, such as "Claude (Anthropic)". */
  readonly label: string
  /** The model in use. */
  readonly model: string
  /** Whether it has what it needs to run (a key, a host). Checked before any request is made. */
  isConfigured(): boolean
  extract(request: ExtractionRequest): Promise<ExtractionResult>
}
