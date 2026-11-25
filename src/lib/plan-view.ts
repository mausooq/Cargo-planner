import type { CargoShape, EquipmentMode, OogClass } from "@compass/domain"
import { maxSide, normaliseSides, resolveSides, sameSetting, type ClearanceSetting, type SideClearance } from "@compass/physics"
import type { SolverResult, UnitMetrics } from "@compass/solver"
import type { ClearanceConfig } from "@/lib/clearance"
import { cargoColor } from "@/lib/format"
import type { UldContour } from "@/lib/uld-contour"

export type PlanItemView = {
  id: string
  cargoId: string
  name: string
  /** The cargo line's mark (SKU), when it has one. Printed on the piece in the 3D view. */
  sku?: string | null
  color: string
  x: number
  y: number
  z: number
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  sequence: number
  rotation: string
  shape: CargoShape
  stackable?: boolean
  bottomOnly?: boolean
  maxStackLoadKg?: number | null
  /** Handling clearance per side in cm when it is the same on every side (own setting or project default); the largest side when directional. */
  clearanceCm?: number
  /** The piece's own front / rear / left / right clearance, resolved, in the orientation it was entered in. Turns with the piece. */
  clearance?: SideClearance
  /** How the cargo line is configured: null inherits the project default, a number is uniform (0 = none), sides are directional. */
  clearanceSetting?: ClearanceSetting
}

export type PlanUnitView = {
  unitIndex: number
  equipmentId: string
  equipmentName: string
  equipmentMode: EquipmentMode
  oogClass: OogClass
  heightOpen: boolean
  contour: UldContour | null
  lengthCm: number
  widthCm: number
  heightCm: number
  maxPayloadKg: number
  pieces: number
  netKg: number
  grossKg: number
  volumeM3: number
  volumePct: number
  /** Same as `floorActualPct`; plans saved before the two floor metrics only have this. */
  floorPct: number
  floorActualPct: number
  floorEffectivePct: number
  weightPct: number
  /** Payload left in kg (negative when over). */
  remainingKg: number
  remainingM3: number
  tareKg: number
  usedLengthCm: number
  usedWidthCm: number
  usedHeightCm: number
  cog: { x: number; y: number; z: number }
  axleLoads: { name: string; kg: number; maxKg: number; positionFromFrontCm: number }[]
  items: PlanItemView[]
}

export type PlanView = {
  /** Project default handling clearance the plan was calculated with, per side in cm. */
  clearanceCm: number
  /** The clearance configuration (default and per-line settings) the plan was calculated or last checked under, when recorded. */
  clearanceConfig?: ClearanceConfig | null
  /** AUTO: laid out by the packer. MANUAL: the planner has moved cargo by hand and saved. */
  layoutSource?: "AUTO" | "MANUAL"
  seed: number
  elapsedMs: number
  totalCost: number
  warnings: string[]
  units: PlanUnitView[]
  unloaded: { cargoId: string; name: string; reason: string; detail: string }[]
}

export type SolverEquipmentHint = {
  id: string
  name: string
  mode: EquipmentMode
  oogClass: OogClass
  heightOpen: boolean
  contour: UldContour | null
  lengthCm: number
  widthCm: number
  heightCm: number
  maxPayloadKg: number
}

export type SolverCargoHint = {
  id: string
  name: string
  sku?: string | null
  weightKg: number
  color: string | null
  shape?: CargoShape
  stackable?: boolean
  bottomOnly?: boolean
  maxStackLoadKg?: number | null
  /** This line's own clearance override, or null/undefined to use the project default. */
  clearanceCm?: number | null
  /** This line's own directional clearance, or null/undefined when it has none. */
  clearanceSides?: SideClearance | null
}

export function toPlanView(
  result: SolverResult,
  equipment: SolverEquipmentHint[],
  cargo: SolverCargoHint[],
): PlanView {
  const equipmentById = new Map(equipment.map((item) => [item.id, item]))
  const cargoById = new Map(cargo.map((item) => [item.id, item]))

  const defaultClearance = result.settings.clearanceCm ?? 0
  return {
    clearanceCm: defaultClearance,
    seed: result.seed,
    elapsedMs: result.elapsedMs,
    totalCost: result.totalCost,
    warnings: result.warnings,
    units: result.units.map((unit) => {
      const type = equipmentById.get(unit.equipmentId)
      return {
        unitIndex: unit.unitIndex,
        equipmentId: unit.equipmentId,
        equipmentName: type?.name ?? "Unit",
        equipmentMode: type?.mode ?? "SEA",
        oogClass: type?.oogClass ?? "NONE",
        heightOpen: type?.heightOpen ?? false,
        contour: type?.contour ?? null,
        lengthCm: type?.lengthCm ?? 0,
        widthCm: type?.widthCm ?? 0,
        heightCm: type?.heightCm ?? 0,
        maxPayloadKg: type?.maxPayloadKg ?? 0,
        pieces: unit.metrics.pieces,
        netKg: unit.metrics.netKg,
        grossKg: unit.metrics.grossKg,
        volumeM3: unit.metrics.volumeM3,
        volumePct: unit.metrics.volumePct,
        floorPct: unit.metrics.floorPct,
        floorActualPct: unit.metrics.floorActualPct,
        floorEffectivePct: unit.metrics.floorEffectivePct,
        weightPct: unit.metrics.weightPct,
        remainingKg: unit.metrics.remainingKg,
        remainingM3: unit.metrics.remainingM3,
        tareKg: Math.round((unit.metrics.grossKg - unit.metrics.netKg) * 10) / 10,
        usedLengthCm: unit.metrics.usedLengthCm,
        usedWidthCm: unit.metrics.usedWidthCm,
        usedHeightCm: unit.metrics.usedHeightCm,
        cog: unit.metrics.cog,
        axleLoads: unit.metrics.axleLoads,
        items: unit.placements.map((placement) => {
          const item = cargoById.get(placement.cargoId)
          return {
            id: `${placement.cargoId}-${placement.instanceIndex}`,
            cargoId: placement.cargoId,
            name: item?.name ?? "Cargo",
            sku: item?.sku ?? null,
            color: cargoColor(item?.name ?? "Cargo", item?.color ?? null),
            x: placement.x,
            y: placement.y,
            z: placement.z,
            lengthCm: placement.lengthCm,
            widthCm: placement.widthCm,
            heightCm: placement.heightCm,
            weightKg: item?.weightKg ?? 0,
            sequence: placement.sequence,
            rotation: placement.rotation,
            shape: item?.shape ?? "BOX",
            stackable: item?.stackable,
            bottomOnly: item?.bottomOnly,
            maxStackLoadKg: item?.maxStackLoadKg,
            ...clearanceFields(item, defaultClearance),
          }
        }),
      }
    }),
    unloaded: result.unloaded.map((row) => ({
      cargoId: row.cargoId,
      name: cargoById.get(row.cargoId)?.name ?? "Cargo",
      reason: row.reason,
      detail: row.detail,
    })),
  }
}

/** A unit with its numbers replaced by freshly recalculated ones (after a layout is saved). */
export function withMetrics(unit: PlanUnitView, metrics: UnitMetrics): PlanUnitView {
  return {
    ...unit,
    pieces: metrics.pieces,
    netKg: metrics.netKg,
    grossKg: metrics.grossKg,
    volumeM3: metrics.volumeM3,
    volumePct: metrics.volumePct,
    floorPct: metrics.floorActualPct,
    floorActualPct: metrics.floorActualPct,
    floorEffectivePct: metrics.floorEffectivePct,
    weightPct: metrics.weightPct,
    remainingKg: metrics.remainingKg,
    remainingM3: metrics.remainingM3,
    usedLengthCm: metrics.usedLengthCm,
    usedWidthCm: metrics.usedWidthCm,
    usedHeightCm: metrics.usedHeightCm,
    cog: metrics.cog,
    axleLoads: metrics.axleLoads,
  }
}

/** The clearance fields of a piece from its cargo line's setting and the project default. One resolution, used everywhere. */
export function clearanceFields(
  line: { clearanceCm?: number | null; clearanceSides?: SideClearance | null } | undefined,
  projectDefault: number,
): Pick<PlanItemView, "clearanceCm" | "clearance" | "clearanceSetting"> {
  const sides = normaliseSides(line?.clearanceSides)
  const uniform = typeof line?.clearanceCm === "number" && line.clearanceCm >= 0 ? line.clearanceCm : null
  const setting: ClearanceSetting = sides ?? uniform
  const resolved = resolveSides(setting, projectDefault)
  return { clearance: resolved, clearanceSetting: setting, clearanceCm: maxSide(resolved) }
}

/**
 * A cargo line's clearance changed for every piece of that line in `items`. Positions, turns and
 * sizes are untouched: the layout is not re-packed, only re-judged. Used by the Playground for a
 * pending change, which Undo, Reset and Cancel simply discard by going back to the earlier items.
 */
export function withLineClearance(
  items: PlanItemView[],
  cargoId: string,
  setting: ClearanceSetting,
  projectDefault: number,
): PlanItemView[] {
  const fields = clearanceFields(
    typeof setting === "number" ? { clearanceCm: setting, clearanceSides: null } : { clearanceCm: null, clearanceSides: setting },
    projectDefault,
  )
  return items.map((item) => (item.cargoId === cargoId ? { ...item, ...fields } : item))
}

/** The lines whose setting differs between the pieces now and the saved ones: what is pending, per line. */
export function pendingClearanceChanges(
  current: PlanItemView[],
  saved: PlanItemView[],
): { cargoId: string; setting: ClearanceSetting }[] {
  const original = new Map(saved.map((item) => [item.cargoId, item.clearanceSetting ?? null]))
  const changes = new Map<string, ClearanceSetting>()
  for (const item of current) {
    const now = item.clearanceSetting ?? null
    if (!sameSetting(now, original.get(item.cargoId) ?? null)) changes.set(item.cargoId, now)
  }
  return [...changes].map(([cargoId, setting]) => ({ cargoId, setting }))
}

/**
 * The pieces as they would be under a proposed clearance change (a new project default and/or new
 * settings for some lines), without moving anything. Used to open the Playground on a draft.
 */
export function withClearanceDraft(
  items: PlanItemView[],
  change: { defaultCm?: number; lines: { cargoId: string; setting: ClearanceSetting }[] },
  projectDefault: number,
): PlanItemView[] {
  const nextDefault = change.defaultCm ?? projectDefault
  const byLine = new Map(change.lines.map((line) => [line.cargoId, line.setting]))
  return items.map((item) => {
    const setting = byLine.has(item.cargoId) ? (byLine.get(item.cargoId) ?? null) : (item.clearanceSetting ?? null)
    return {
      ...item,
      ...clearanceFields(
        typeof setting === "number" ? { clearanceCm: setting, clearanceSides: null } : { clearanceCm: null, clearanceSides: setting },
        nextDefault,
      ),
    }
  })
}
