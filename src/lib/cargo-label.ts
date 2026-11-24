/**
 * Fitting a cargo label onto one face of a box in the 3D view. Pure layout maths, no drawing:
 * given the space on the face and a way to measure text, it picks the largest font size at which
 * the whole label fits, wrapping at word breaks. Only when the label cannot fit even at the
 * smallest readable size is it cut short, with an ellipsis.
 */

/** Width in pixels of `text` at `fontSize`. `bold` is true for the mark line. */
export type MeasureText = (text: string, fontSize: number, bold: boolean) => number

export type LabelLine = { text: string; bold: boolean }
export type LabelLayout = {
  fontSize: number
  lineHeight: number
  lines: LabelLine[]
  /** Widest line and total height of the text block, in pixels. */
  width: number
  height: number
  /** True when the label had to be cut short to fit. */
  truncated: boolean
}

const LINE_SPACING = 1.2
const ELLIPSIS = "…"

/**
 * What to print on a piece: its mark (SKU) on its own line when it has one that the name does not
 * already show, then the name.
 */
export function cargoLabelParts(sku: string | null | undefined, name: string): { mark: string | null; text: string } {
  const mark = sku?.trim() || null
  const text = name.trim()
  if (!mark) return { mark: null, text: text || "Cargo" }
  if (!text || text.toLowerCase() === mark.toLowerCase()) return { mark: null, text: mark }
  if (text.toLowerCase().includes(mark.toLowerCase())) return { mark: null, text }
  return { mark, text }
}

/** Pixel size of the drawing surface for a face, keeping the face's own shape so text is never stretched. */
export function faceCanvasSize(aspect: number): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? Math.min(24, Math.max(1 / 24, aspect)) : 1
  const wide = safe >= 1
  const ratio = wide ? safe : 1 / safe
  let long = 320
  let short = long / ratio
  if (short < 56) {
    // A long thin face: keep the short side tall enough to hold a line of text.
    short = 56
    long = Math.min(1024, short * ratio)
  }
  const a = Math.round(long)
  const b = Math.round(short)
  return wide ? { width: a, height: b } : { width: b, height: a }
}

function breakWord(word: string, maxWidth: number, fontSize: number, measure: MeasureText): string[] {
  const parts: string[] = []
  let current = ""
  for (const char of word) {
    if (current && measure(current + char, fontSize, false) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}

/** Greedy word wrap. Returns null when a word is wider than the line and `breakLongWords` is off. */
function wrap(text: string, maxWidth: number, fontSize: number, bold: boolean, measure: MeasureText, breakLongWords: boolean): string[] | null {
  const lines: string[] = []
  let current = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = current ? `${current} ${word}` : word
    if (measure(trial, fontSize, bold) <= maxWidth) {
      current = trial
      continue
    }
    if (current) lines.push(current)
    if (measure(word, fontSize, bold) <= maxWidth) {
      current = word
      continue
    }
    if (!breakLongWords) return null
    const pieces = breakWord(word, maxWidth, fontSize, measure)
    current = pieces.pop() ?? ""
    lines.push(...pieces)
  }
  if (current) lines.push(current)
  return lines
}

function withEllipsis(text: string, maxWidth: number, fontSize: number, bold: boolean, measure: MeasureText): string {
  let cut = text.trimEnd()
  while (cut.length > 1 && measure(cut + ELLIPSIS, fontSize, bold) > maxWidth) cut = cut.slice(0, -1).trimEnd()
  return cut + ELLIPSIS
}

function finish(lines: LabelLine[], fontSize: number, measure: MeasureText, truncated: boolean): LabelLayout {
  const lineHeight = fontSize * LINE_SPACING
  const width = lines.reduce((widest, line) => Math.max(widest, measure(line.text, fontSize, line.bold)), 0)
  return { fontSize, lineHeight, lines, width, height: lines.length * lineHeight, truncated }
}

export function layoutLabel(input: {
  mark: string | null
  text: string
  maxWidth: number
  maxHeight: number
  maxFontSize: number
  minFontSize: number
  measure: MeasureText
}): LabelLayout {
  const { mark, text, maxWidth, maxHeight, measure } = input
  const minFont = Math.max(1, Math.floor(input.minFontSize))
  const maxFont = Math.max(minFont, Math.floor(input.maxFontSize))

  // Largest size at which every word stays whole and all lines fit.
  for (let size = maxFont; size >= minFont; size -= 1) {
    const markLines = mark ? wrap(mark, maxWidth, size, true, measure, false) : []
    const textLines = wrap(text, maxWidth, size, false, measure, false)
    if (!markLines || !textLines) continue
    const count = markLines.length + textLines.length
    if (count * size * LINE_SPACING > maxHeight) continue
    return finish(
      [...markLines.map((line) => ({ text: line, bold: true })), ...textLines.map((line) => ({ text: line, bold: false }))],
      size,
      measure,
      false,
    )
  }

  // Does not fit even at the smallest size: break long words, keep what fits, end with an ellipsis.
  const all: LabelLine[] = [
    ...(mark ? (wrap(mark, maxWidth, minFont, true, measure, true) ?? []).map((line) => ({ text: line, bold: true })) : []),
    ...(wrap(text, maxWidth, minFont, false, measure, true) ?? []).map((line) => ({ text: line, bold: false })),
  ]
  const room = Math.max(1, Math.floor(maxHeight / (minFont * LINE_SPACING)))
  if (all.length <= room) return finish(all, minFont, measure, false)
  const kept = all.slice(0, room)
  const last = kept[kept.length - 1]
  if (last) kept[kept.length - 1] = { ...last, text: withEllipsis(last.text, maxWidth, minFont, last.bold, measure) }
  return finish(kept, minFont, measure, true)
}
