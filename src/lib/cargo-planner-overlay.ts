import { readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeUldName } from "./uld-kinds"
import { emptyContour, hasContourCuts, parseContour, type UldContour } from "./uld-contour"

export type CargoPlannerOverlay = {
  name: string
  mode: string
  innerLengthCm: number
  innerWidthCm: number
  innerHeightCm: number
  maxPayloadKg: number | null
  tareKg: number | null
  doorWidthCm: number | null
  doorHeightCm: number | null
  contour: UldContour | null
}

type LibraryFile = {
  items?: Array<{
    name: string
    mode: string
    innerLengthCm: number
    innerWidthCm: number
    innerHeightCm: number
    maxPayloadKg?: number | null
    tareKg?: number | null
    doorWidthCm?: number | null
    doorHeightCm?: number | null
    contour?: unknown
  }>
}

const ALIASES: Record<string, string> = {
  [normalizeUldName("Eastern Trailer (tail)")]: normalizeUldName("Eastern Trailer (tall)"),
}

export function loadCargoPlannerOverlays(): Map<string, CargoPlannerOverlay> {
  const index = new Map<string, CargoPlannerOverlay>()
  const file = readLibraryFile()
  for (const item of file.items ?? []) {
    const contour = parseContour(item.contour)
    index.set(normalizeUldName(item.name), {
      name: item.name,
      mode: item.mode,
      innerLengthCm: item.innerLengthCm,
      innerWidthCm: item.innerWidthCm,
      innerHeightCm: item.innerHeightCm,
      maxPayloadKg: item.maxPayloadKg ?? null,
      tareKg: item.tareKg ?? null,
      doorWidthCm: item.doorWidthCm ?? null,
      doorHeightCm: item.doorHeightCm ?? null,
      contour: hasContourCuts(contour) ? contour : null,
    })
  }
  return index
}

export function findCargoPlannerOverlay(
  name: string,
  index = loadCargoPlannerOverlays(),
): CargoPlannerOverlay | undefined {
  const key = normalizeUldName(name)
  return index.get(key) ?? index.get(ALIASES[key] ?? "")
}

export function overlayNotes(name: string, existing: string | null): string {
  const bits = [existing, `Details aligned to Cargo-Planner equipment library (${name}).`].filter(Boolean)
  return bits.join(" ")
}

export function emptyDoor(): { doorWidthCm: null; doorHeightCm: null } {
  return { doorWidthCm: null, doorHeightCm: null }
}

export { emptyContour }

function readLibraryFile(): LibraryFile {
  try {
    const raw = readFileSync(join(process.cwd(), "src/lib/cargo-planner-library.json"), "utf8")
    return JSON.parse(raw) as LibraryFile
  } catch {
    return { items: [] }
  }
}
