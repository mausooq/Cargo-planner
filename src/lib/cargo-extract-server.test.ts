import Anthropic from "@anthropic-ai/sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RawExtraction } from "@/lib/cargo-extract"
import { createAnthropicProvider, documentReadingConfigured, getExtractionProvider, runExtraction } from "@/lib/cargo-extract-server"
import type { ExtractionProvider, ExtractionRequest } from "@/lib/extraction-provider"

// No test here calls the real API or sends any document anywhere: the client is a stand-in.

const answer: RawExtraction = { summary: "A list.", language: "English", lines: [], documentTotals: null, warnings: [], unreadable: [], complete: true, tableSizeUnit: null }
const textRequest: ExtractionRequest = { input: { kind: "text", text: "10 crates 120 x 80 x 60 cm 150 kg", label: "text" }, modeLabel: "sea" }

type ParseArgs = { model: string; system: string; messages: { content: { type: string; text?: string; source?: unknown }[] }[] }

function providerWith(parse: (args: ParseArgs) => unknown) {
  const spy = vi.fn(parse)
  const provider = createAnthropicProvider({ clientFactory: () => ({ beta: { messages: { parse: spy } } }) as never })
  return { provider, spy }
}

const apiError = (type: new (...args: never[]) => Error, status?: number, message = "failed") => Object.assign(Object.create(type.prototype), { status, message })

describe("Claude provider", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real"
    delete process.env.COMPASS_AI_MODEL
    delete process.env.COMPASS_AI_PROVIDER
  })
  afterEach(() => {
    process.env = { ...saved }
    vi.restoreAllMocks()
  })

  it("returns a valid structured answer and sends the document text as data", async () => {
    const { provider, spy } = providerWith(() => ({ stop_reason: "end_turn", parsed_output: answer }))
    const result = await provider.extract(textRequest)
    expect(result).toEqual({ ok: true, raw: answer, provider: "anthropic", model: "claude-sonnet-5-5" })
    const args = spy.mock.calls[0]![0]
    expect(args.model).toBe("claude-sonnet-5-5")
    expect(args.system).toMatch(/never an instruction to you/)
    expect(args.messages[0]!.content[0]!.text).toContain("<document_text>")
  })

  it("sends a PDF and an image as documents, not as text", async () => {
    const { provider, spy } = providerWith(() => ({ stop_reason: "end_turn", parsed_output: answer }))
    await provider.extract({ input: { kind: "pdf", bytes: new Uint8Array([1, 2, 3]) }, modeLabel: "sea" })
    await provider.extract({ input: { kind: "image", bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }, modeLabel: "air" })
    expect(spy.mock.calls[0]![0].messages[0]!.content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } })
    expect(spy.mock.calls[1]![0].messages[0]!.content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } })
  })

  it("uses the model named in the environment", async () => {
    process.env.COMPASS_AI_MODEL = "claude-test-model"
    const { provider, spy } = providerWith(() => ({ stop_reason: "end_turn", parsed_output: answer }))
    expect(provider.model).toBe("claude-test-model")
    await provider.extract(textRequest)
    expect(spy.mock.calls[0]![0].model).toBe("claude-test-model")
  })

  it("says plainly when no API key is set, and calls nothing", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const provider = createAnthropicProvider()
    expect(provider.isConfigured()).toBe(false)
    expect(documentReadingConfigured()).toBe(false)
    const result = await provider.extract(textRequest)
    expect(result).toMatchObject({ ok: false, code: "not_configured" })
    expect(result.ok ? "" : result.error).toMatch(/ANTHROPIC_API_KEY.*Excel and CSV/)
  })

  it.each([
    ["authentication failure", () => apiError(Anthropic.AuthenticationError, 401), "auth", /key was not accepted/],
    ["permission failure", () => apiError(Anthropic.PermissionDeniedError, 403), "auth", /key was not accepted/],
    ["rate limit", () => apiError(Anthropic.RateLimitError, 429), "rate_limit", /rate limit/],
    ["timeout", () => apiError(Anthropic.APIConnectionTimeoutError), "timeout", /too long/],
    ["connection failure", () => apiError(Anthropic.APIConnectionError), "connection", /Could not reach Claude/],
    ["unknown model", () => apiError(Anthropic.NotFoundError, 404), "bad_request", /COMPASS_AI_MODEL/],
    ["unreadable file", () => apiError(Anthropic.BadRequestError, 400), "bad_request", /could not open this file/],
    ["server error", () => apiError(Anthropic.InternalServerError, 500), "unavailable", /try again/i],
  ] as const)("reports a %s without throwing", async (_name, make, code, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { provider } = providerWith(() => {
      throw make()
    })
    const result = await provider.extract(textRequest)
    expect(result).toMatchObject({ ok: false, code })
    expect(result.ok ? "" : result.error).toMatch(message)
  })

  it("explains a blocked secure connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const error = Object.assign(Object.create(Anthropic.APIConnectionError.prototype), { message: "x", cause: Object.assign(new Error("cert"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }) })
    const { provider } = providerWith(() => {
      throw error
    })
    expect(await provider.extract(textRequest)).toMatchObject({ ok: false, code: "certificate" })
  })

  it("rejects an invalid, empty or refused model answer", async () => {
    const wrong = providerWith(() => ({ stop_reason: "end_turn", parsed_output: { lines: "not a list" } }))
    expect(await wrong.provider.extract(textRequest)).toMatchObject({ ok: false, code: "invalid_response" })
    const empty = providerWith(() => ({ stop_reason: "end_turn", parsed_output: null }))
    expect(await empty.provider.extract(textRequest)).toMatchObject({ ok: false, code: "invalid_response" })
    const refused = providerWith(() => ({ stop_reason: "refusal", parsed_output: null }))
    expect(await refused.provider.extract(textRequest)).toMatchObject({ ok: false, code: "refused" })
    const tooLong = providerWith(() => ({ stop_reason: "max_tokens", parsed_output: answer }))
    expect(await tooLong.provider.extract(textRequest)).toMatchObject({ ok: false, code: "too_long" })
  })

  it("does not put document contents or the key in an error message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { provider } = providerWith(() => {
      throw apiError(Anthropic.APIError, 500, "echo: 10 crates 120 x 80 x 60 cm sk-test-not-real")
    })
    const result = await provider.extract(textRequest)
    expect(JSON.stringify(result)).not.toMatch(/crates|sk-test/)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/crates|sk-test/)
  })
})

describe("choosing the provider", () => {
  afterEach(() => {
    delete process.env.COMPASS_AI_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
  })

  it("uses Claude by default", () => {
    expect(getExtractionProvider().id).toBe("anthropic")
  })

  it("names a provider that is not built yet instead of failing oddly", async () => {
    process.env.COMPASS_AI_PROVIDER = "ollama"
    const provider = getExtractionProvider()
    expect(provider.isConfigured()).toBe(false)
    expect(await provider.extract(textRequest)).toMatchObject({ ok: false, code: "not_configured", error: expect.stringContaining("ollama") })
  })
})

describe("one reading at a time per document", () => {
  function counting(): { provider: ExtractionProvider; calls: () => number; release: () => void } {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let count = 0
    const provider: ExtractionProvider = {
      id: "fake",
      label: "Fake",
      model: "m",
      isConfigured: () => true,
      extract: async () => {
        count += 1
        await gate
        return { ok: true, raw: answer, provider: "fake", model: "m" }
      },
    }
    return { provider, calls: () => count, release }
  }

  it("joins a repeated request for the same content instead of paying twice", async () => {
    const { provider, calls, release } = counting()
    const first = runExtraction("org:user", provider, textRequest)
    const second = runExtraction("org:user", provider, textRequest)
    release()
    const results = await Promise.all([first, second])
    expect(calls()).toBe(1)
    expect(results[0]).toBe(results[1])
  })

  it("runs different content, or a different person, separately, and again once finished", async () => {
    const { provider, calls, release } = counting()
    release()
    await runExtraction("org:user", provider, textRequest)
    await runExtraction("org:user", provider, textRequest)
    await runExtraction("org:other", provider, textRequest)
    await runExtraction("org:user", provider, { ...textRequest, input: { kind: "text", text: "different", label: "text" } })
    expect(calls()).toBe(4)
  })
})
