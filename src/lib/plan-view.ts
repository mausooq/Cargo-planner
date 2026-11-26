import type { CargoShape, EquipmentMode, OogClass } from "@compass/domain"
import type { SolverResult, UnitMetrics } from "@compass/solver"
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
  /** Floor utilization: the exact share of the floor covered by the cargo's own footprints. */
  floorPct: number
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
}

export function toPlanView(
  result: SolverResult,
  equipment: SolverEquipmentHint[],
  cargo: SolverCargoHint[],
): PlanView {
  const equipmentById = new Map(equipment.map((item) => [item.id, item]))
  const cargoById = new Map(cargo.map((item) => [item.id, item]))

  return {
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
    floorPct: metrics.floorPct,
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
