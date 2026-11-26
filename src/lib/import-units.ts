import { lengthUnitFromWord, parseLength, type LengthUnit } from "@/lib/cargo-units"

/**
 * Reading the numbers, weights and combined sizes that appear in packing lists, wherever they came
 * from (a spreadsheet cell, an AI reading, pasted text). Lengths reuse `parseLength` from
 * cargo-units.ts, so feet, inches and feet-and-inches behave exactly as they do in the Cargo grid.
 * Nothing here guesses a unit: when a value does not say its unit and none was chosen, the result
 * says so and the planner picks one.
 */

// ---- numbers ---------------------------------------------------------------------------------

export type NumberRead = {
  value: number
  /** True when the written form can be read two ways (1,200 or 1.200: one thousand two hundred, or one and two tenths). */
  ambiguous: boolean
}

/**
 * A plain number as written in documents from different countries. `1,200.5`, `1.200,5`, `1 200,5`
 * and `1'200.5` are read by where the last separator is, and `5,5` is a decimal comma. A single
 * separator followed by exactly three digits (1,200 or 1.200) can be read two ways: it is read the
 * English way (comma groups thousands, dot is the decimal point, as everywhere else in Compass) and
 * flagged, so the planner confirms it. A number that starts with 0 (0.777) is always a decimal.
 */
export function readNumber(text: string): NumberRead | null {
  const raw = text.trim().replace(/[  \s]/g, (space, offset: number, whole: string) => {
    // A space between digit groups is a thousands separator; anywhere else it is just padding.
    const before = whole[offset - 1]
    const after = whole[offset + 1]
    return before !== undefined && after !== undefined && /\d/.test(before) && /\d/.test(after) ? "" : space.trim()
  })
  if (!/^[+-]?\d[\d.,'’]*$|^[+-]?[.,]\d+$/.test(raw)) return null
  const sign = raw.startsWith("-") ? -1 : 1
  const body = raw.replace(/^[+-]/, "").replace(/['’]/g, "")
  const lastDot = body.lastIndexOf(".")
  const lastComma = body.lastIndexOf(",")
  const dots = (body.match(/\./g) ?? []).length
  const commas = (body.match(/,/g) ?? []).length
  let ambiguous = false
  let normalised: string

  if (lastDot >= 0 && lastComma >= 0) {
    // Both appear: the later one is the decimal mark, the other groups thousands.
    const decimalMark = lastDot > lastComma ? "." : ","
    const group = decimalMark === "." ? "," : "."
    normalised = body.split(group).join("").replace(decimalMark, ".")
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? "." : ","
    const count = mark === "." ? dots : commas
    const index = mark === "." ? lastDot : lastComma
    const digitsAfter = body.length - index - 1
    if (count > 1) {
      // 1.200.300 can only be grouping.
      normalised = body.split(mark).join("")
    } else if (digitsAfter === 3 && index > 0 && index <= 3 && !body.startsWith("0")) {
      // English reading: a comma groups thousands, a dot is the decimal point. The other reading is possible, so flag it.
      normalised = mark === "," ? body.replace(",", "") : body
      ambiguous = true
    } else {
      normalised = body.replace(mark, ".")
    }
  } else {
    normalised = body
  }
  const value = Number(normalised)
  return Number.isFinite(value) ? { value: sign * value, ambiguous } : null
}

// ---- weights ---------------------------------------------------------------------------------

export const IMPORT_WEIGHT_UNITS = ["kg", "g", "t", "lb"] as const
export type ImportWeightUnit = (typeof IMPORT_WEIGHT_UNITS)[number]

export const KG_PER_WEIGHT_UNIT: Record<ImportWeightUnit, number> = { kg: 1, g: 0.001, t: 1000, lb: 0.45359237 }

export const IMPORT_WEIGHT_UNIT_LABEL: Record<ImportWeightUnit, string> = {
  kg: "kg (kilograms)",
  g: "g (grams)",
  t: "t (tonnes)",
  lb: "lb (pounds)",
}

// "ton" and "tons" are left out on purpose: a short ton, a long ton and a metric tonne differ.
const WEIGHT_WORD: Record<string, ImportWeightUnit> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  t: "t",
  mt: "t",
  tonne: "t",
  tonnes: "t",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
}

export function weightUnitFromWord(word: string): ImportWeightUnit | null {
  return WEIGHT_WORD[word.trim().toLowerCase().replace(/\.$/, "")] ?? null
}

export type WeightParse =
  | { ok: true; kg: number; unit: ImportWeightUnit; explicit: boolean; ambiguousNumber: boolean }
  | { ok: false; reason: string }

/**
 * A weight as written ("150", "150 kg", "1.2 t", "330 lbs") in kilograms. A unit written after the
 * number wins; a bare number uses `defaultUnit`, and with no default it is refused so the planner
 * picks one. Conversions use fixed factors: g 0.001, t 1000, lb 0.45359237.
 */
export function parseWeight(text: string, defaultUnit: ImportWeightUnit | null): WeightParse {
  const raw = text.trim()
  if (raw === "") return { ok: false, reason: "Enter a weight." }
  if (raw.startsWith("-")) return { ok: false, reason: "A weight cannot be negative." }
  const match = /^(.*?)\s*([A-Za-z]{1,12}\.?)?$/.exec(raw)
  const numberText = match?.[1] ?? raw
  const word = match?.[2]
  const number = readNumber(numberText)
  if (!number) return { ok: false, reason: "That weight is not a number." }
  let unit = defaultUnit
  let explicit = false
  if (word) {
    const written = weightUnitFromWord(word)
    if (!written) {
      return { ok: false, reason: /^tons?$/i.test(word) ? "“ton” can mean a short, long or metric ton. Write the weight in tonnes or kg." : `“${word}” is not a weight unit.` }
    }
    unit = written
    explicit = true
  }
  if (!unit) return { ok: false, reason: "The weight unit is not stated. Choose it." }
  return { ok: true, kg: Math.round(number.value * KG_PER_WEIGHT_UNIT[unit] * 10000) / 10000, unit, explicit, ambiguousNumber: number.ambiguous }
}

// ---- combined sizes ----------------------------------------------------------------------------

// x, ×, * and the word "by" between sizes. A plain x is only a separator when a number or a unit sits on both sides, so words such as "box" are left alone.
const SIZE_SEPARATOR = /\s*[×*✕]\s*|\s+by\s+|(?<=[\d"'”″’′)]|\b(?:mm|cm|m|in|ft))\s*x\s*(?=[\d.,(])/i

export type CombinedSize = {
  /** Three size texts, as written (a unit may be inside each). */
  parts: [string, string, string]
  /** The one unit written once for the whole size ("120 x 80 x 60 cm"), or null when none or mixed. */
  unit: LengthUnit | null
}

const UNIT_AT_END = /(?:^|[\d\s"'”″’′])((?:millimet(?:re|er)s?|centimet(?:re|er)s?|met(?:re|er)s?|inch(?:es)?|feet|foot|mm|cm|m|in|ft)\.?)$/i

/** The unit written after a size text, if any ("60 cm" → cm). Apostrophe and quote marks count as feet and inches. */
function trailingUnit(part: string): LengthUnit | null {
  const trimmed = part.trim()
  if (/\d\s*"$|\d\s*″$|\d\s*”$/.test(trimmed)) return "in"
  const found = UNIT_AT_END.exec(trimmed)
  return found ? lengthUnitFromWord(found[1]!.replace(/\.$/, "")) : null
}

/**
 * Splits "120 x 80 x 60 cm", "1.2 x 0.8 x 0.6 m", "48 x 32 x 24 in" or "5 ft 6 in x 3 ft x 2 ft" into
 * its three parts. A unit written once at the end applies to all three; a unit written on every part
 * stays with its part; if only some parts name a unit and they disagree, no unit is assumed.
 */
export function splitCombinedSize(text: string): CombinedSize | null {
  const cleaned = text.trim().replace(/\s+/g, " ")
  if (!cleaned) return null
  const pieces = cleaned.split(SIZE_SEPARATOR).map((piece) => piece.trim())
  if (pieces.length !== 3 || pieces.some((piece) => piece === "")) return null
  const units = pieces.map(trailingUnit)
  const distinct = new Set(units.filter((unit): unit is LengthUnit => unit !== null))
  // Same unit on every part that has one, and at least the last part has it: it covers the whole size.
  const last = units[2] ?? null
  const unit = distinct.size === 1 && last !== null ? last : null
  return { parts: pieces as [string, string, string], unit }
}

/** Whether a size text carries a unit of its own (cm, ft, 5'6" and so on). */
export function hasLengthUnit(text: string): boolean {
  return /[A-Za-z"'″′”’]/.test(text.trim().replace(/^[\d\s.,]+/, "")) && /\d/.test(text)
}

export type SizeRead = { ok: true; cm: number; needsUnit: false } | { ok: true; cm: null; needsUnit: true } | { ok: false; reason: string }

/** One size text in centimetres, or "needs a unit" when it carries none and none was chosen. */
export function readSize(text: string, unit: LengthUnit | null): SizeRead {
  const cleaned = text.trim()
  if (cleaned === "") return { ok: false, reason: "Missing." }
  if (!hasLengthUnit(cleaned) && unit === null) {
    const number = readNumber(cleaned)
    if (!number) return { ok: false, reason: "That size is not a number." }
    return { ok: true, cm: null, needsUnit: true }
  }
  // parseLength reads decimal commas (5,5); thousands separators are removed first, as the grid importer does.
  const number = /^[\d.,\s]+$/.test(cleaned) ? readNumber(cleaned) : null
  const prepared = number ? String(number.value) : cleaned
  const parsed = parseLength(prepared, unit ?? "cm")
  return parsed.ok ? { ok: true, cm: parsed.cm, needsUnit: false } : { ok: false, reason: parsed.reason }
}

// ---- net and gross written together ------------------------------------------------------------------

export type NetGross = { gross: string; net: string }

const NET_WORD = String.raw`(?:net|n\.?\s?w\.?|nett|netto|neto|poids\s+net|净重)`
const GROSS_WORD = String.raw`(?:gross|g\.?\s?w\.?|brutto|bruto|poids\s+brut|毛重)`
const AMOUNT = String.raw`\d[\d.,'’]*(?:\s\d{3}(?!\d))*`
const UNIT_WORD = String.raw`(?:kgs?|kilograms?|kilogrammes?|g|grams?|t|tonnes?|lbs?|pounds?)(?![A-Za-z]|\.[A-Za-z])`

/**
 * A weight cell that holds both weights, such as "2210 net / 2360 gross", "NW 2210 kg, GW 2360 kg" or
 * "2210 kg (net) 2360 kg (gross)". Returns each as its own number with its unit, or null when the text
 * is not clearly one net and one gross (one number, or two numbers with no labels, is left alone).
 */
export function splitNetGross(text: string): NetGross | null {
  const raw = text.trim()
  if (!raw) return null
  const found: { kind: "net" | "gross"; value: string }[] = []
  const take = (kind: "net" | "gross", amount: string, unit: string | undefined) => {
    if (!found.some((entry) => entry.kind === kind)) found.push({ kind, value: `${amount.trim()}${unit ? ` ${unit.trim()}` : ""}` })
  }
  const after = new RegExp(String.raw`(${AMOUNT})\s*(${UNIT_WORD})?\s*[(\[]?\s*(${NET_WORD}|${GROSS_WORD})(?:\b|(?<=\.))`, "gi")
  const before = new RegExp(String.raw`(${NET_WORD}|${GROSS_WORD})(?:\b|(?<=\.))\s*[:=-]?\s*(${AMOUNT})\s*(${UNIT_WORD})?`, "gi")
  const isNet = (label: string) => new RegExp(`^${NET_WORD}$`, "i").test(label.trim())
  const readAfter = () => {
    for (const match of raw.matchAll(after)) take(isNet(match[3]!) ? "net" : "gross", match[1]!, match[2])
  }
  const readBefore = () => {
    for (const match of raw.matchAll(before)) take(isNet(match[1]!) ? "net" : "gross", match[2]!, match[3])
  }
  // "NW 2210 GW 2360": the label comes first. "2210 net 2360 gross": the label comes after. The start of the text tells which.
  const labelFirst = new RegExp(String.raw`^\s*[(\[]?\s*(?:${NET_WORD}|${GROSS_WORD})(?:\b|(?<=\.))`, "i").test(raw)
  if (labelFirst) {
    readBefore()
    if (found.length < 2) {
      found.length = 0
      readAfter()
    }
  } else {
    readAfter()
    if (found.length < 2) {
      found.length = 0
      readBefore()
    }
  }
  const gross = found.find((entry) => entry.kind === "gross")
  const net = found.find((entry) => entry.kind === "net")
  if (!gross || !net) return null
  // A unit written once covers both ("2210 / 2360 kg" style texts already carry it on the last number).
  const unitOf = (value: string) => /[A-Za-z]+$/.exec(value)?.[0]
  const shared = unitOf(gross.value) ?? unitOf(net.value)
  const withUnit = (value: string) => (unitOf(value) || !shared ? value : `${value} ${shared}`)
  return { gross: withUnit(gross.value), net: withUnit(net.value) }
}
