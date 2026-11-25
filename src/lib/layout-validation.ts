import { allowsHalfTurn, DEFAULT_PHYSICS_SETTINGS, parseRotation, validateDrop } from "@compass/physics"
import { orientationsFor, type SolverCargo } from "@compass/solver"
import { itemToPiece, unitToWorld } from "@/lib/cargo-physics"
import { MIN_SUPPORT_PCT } from "@/lib/clearance"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

/**
 * Server-side check of a hand-edited layout, using the same physics the Playground uses
 * (`validateDrop`: walls, collision, handling clearance, support, stacking and floor-only rules)
 * plus the cargo line's own rotation rules. It does not re-run the packer.
 *
 * A piece that was already invalid in the layout being replaced (a plan saved by an older version)
 * is only reported if it moved, so opening an old plan and nudging one piece is not blocked by
 * something the user did not touch.
 */

export type LayoutCargoRules = Pick<
  SolverCargo,
  "lengthCm" | "widthCm" | "heightCm" | "orientation" | "shape" | "allowedRotations"
>

export type LayoutPiece = {
  item: PlanItemView
  cargo: LayoutCargoRules
}

export type LayoutProblem = { id: string; message: string }
export type LayoutCheck = { ok: true } | { ok: false; problems: string[]; pieces: LayoutProblem[] }

/** What a layout is judged by. The project's value is the one source for the minimum support share. */
export type LayoutSettings = {
  /** Smallest share of a stacked piece's footprint that must rest on something (0 to 1). */
  minSupportRatio?: number
}

export const DEFAULT_MIN_SUPPORT_RATIO = MIN_SUPPORT_PCT.fallback / 100 // the one shared default, 75%

const POSITION_TOLERANCE_CM = 0.6
const DIMENSION_TOLERANCE_CM = 0.05

function label(item: PlanItemView): string {
  return item.name || "A piece"
}

/** The sizes along x, y, z for a rotation code, from the cargo line's entered length, width and height. */
function sizesForAxes(cargo: LayoutCargoRules, axes: string): [number, number, number] | null {
  const size: Record<string, number> = { L: cargo.lengthCm, W: cargo.widthCm, H: cargo.heightCm }
  if (axes.length !== 3 || new Set(axes).size !== 3) return null
  const [x, y, z] = axes.split("").map((letter) => size[letter])
  return x === undefined || y === undefined || z === undefined ? null : [x, y, z]
}

/**
 * Is the piece turned in a way its cargo line allows, and does its rotation code agree with its
 * sizes? The code matters because directional clearance follows it, so a client cannot claim a
 * different facing than the one the sizes imply.
 */
export function rotationProblem(item: PlanItemView, cargo: LayoutCargoRules): string | null {
  const legal = orientationsFor(cargo).some(
    (dim) =>
      Math.abs(dim.l - item.lengthCm) <= DIMENSION_TOLERANCE_CM &&
      Math.abs(dim.w - item.widthCm) <= DIMENSION_TOLERANCE_CM &&
      Math.abs(dim.h - item.heightCm) <= DIMENSION_TOLERANCE_CM,
  )
  if (!legal) return `${label(item)} is turned in a way its cargo line does not allow.`
  // A fixed orientation means exactly as entered: not turned, and not facing the other way even where the footprint is square.
  if (cargo.orientation === "FIXED" && (item.rotation ?? "LWH") !== "LWH") {
    return `${label(item)} may not be turned: its cargo line fixes its orientation.`
  }
  const parsed = parseRotation(item.rotation)
  const sizes = sizesForAxes(cargo, parsed.axes)
  if (!sizes) return `${label(item)} has an unknown rotation.`
  const matches =
    Math.abs(sizes[0] - item.lengthCm) <= DIMENSION_TOLERANCE_CM &&
    Math.abs(sizes[1] - item.widthCm) <= DIMENSION_TOLERANCE_CM &&
    Math.abs(sizes[2] - item.heightCm) <= DIMENSION_TOLERANCE_CM
  if (!matches) return `${label(item)} has a rotation that does not match its sizes.`
  if ((item.rotation ?? "").includes("@")) {
    if (parsed.turns === null) return `${label(item)} has an unknown rotation.`
    if (!allowsHalfTurn(cargo.orientation)) return `${label(item)} may not face the other way: its cargo line fixes its orientation.`
  }
  return null
}

/** Problems for every piece in `pieces`, keyed by piece id. Empty map means a valid layout. */
export function layoutProblems(
  unit: Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm">,
  pieces: LayoutPiece[],
  settings: LayoutSettings = {},
): Map<string, string> {
  const world = unitToWorld(unit)
  const bodies = pieces.map((piece) => itemToPiece(piece.item))
  const problems = new Map<string, string>()
  const minSupportRatio = settings.minSupportRatio ?? DEFAULT_PHYSICS_SETTINGS.minSupportRatio
  pieces.forEach((piece, index) => {
    const { item, cargo } = piece
    const rotation = rotationProblem(item, cargo)
    if (rotation) {
      problems.set(item.id, rotation)
      return
    }
    // `validateDrop` settles a piece onto anything under its footprint, which suits a piece being
    // dragged from above but would drop a lower piece onto the one stacked on it. Each piece is
    // therefore checked against the pieces at or below its own level; the upper one of any pair is
    // checked against the lower one from its own turn.
    const level = pieces.map((other) => other.item.z < item.z + POSITION_TOLERANCE_CM)
    const result = validateDrop(
      world,
      bodies.filter((_, otherIndex) => otherIndex === index || level[otherIndex]),
      bodies[index]!,
      { x: item.x, y: item.y, z: item.z },
      // Payload and axle limits are warnings in the saved metrics, not blocks, matching the
      // Playground's non-strict mode. Everything else is the Playground's default rule set, with the
      // project's minimum support share.
      { ...DEFAULT_PHYSICS_SETTINGS, maxPayloadKg: null, minSupportRatio },
    )
    if (!result.valid) {
      problems.set(item.id, `${label(item)}: ${result.message}.`)
      return
    }
    const drift = Math.max(
      Math.abs(result.position.x - item.x),
      Math.abs(result.position.y - item.y),
      Math.abs(result.position.z - item.z),
    )
    if (drift > POSITION_TOLERANCE_CM) {
      problems.set(item.id, `${label(item)} is not resting on the floor or on another piece.`)
    }
  })
  return problems
}

/**
 * `before` is the layout being replaced, `after` the one to save. Returns the problems the save
 * introduces: pieces that moved (or changed turn or clearance) and are invalid, plus any piece that
 * was fine before and is not now (for example something left floating after the piece under it
 * moved, or a piece that no longer has room for a larger clearance).
 */
export function checkLayoutChange(
  unit: Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm">,
  before: LayoutPiece[],
  after: LayoutPiece[],
  settings: LayoutSettings = {},
): LayoutCheck {
  const nowInvalid = layoutProblems(unit, after, settings)
  if (nowInvalid.size === 0) return { ok: true }
  const wasInvalid = layoutProblems(unit, before, settings)
  const previous = new Map(before.map((piece) => [piece.item.id, piece.item]))
  const reported: LayoutProblem[] = []
  for (const [id, message] of nowInvalid) {
    const old = previous.get(id)
    const next = after.find((piece) => piece.item.id === id)?.item
    const moved =
      !old ||
      !next ||
      Math.abs(old.x - next.x) > 0.01 ||
      Math.abs(old.y - next.y) > 0.01 ||
      Math.abs(old.z - next.z) > 0.01 ||
      old.lengthCm !== next.lengthCm ||
      old.widthCm !== next.widthCm ||
      old.heightCm !== next.heightCm ||
      old.rotation !== next.rotation
    if (moved || !wasInvalid.has(id)) reported.push({ id, message })
  }
  return reported.length === 0
    ? { ok: true }
    : { ok: false, problems: reported.map((entry) => entry.message), pieces: reported }
}
