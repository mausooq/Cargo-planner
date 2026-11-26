import { cargoShapeSchema, equipmentModeSchema, oogClassSchema } from "@compass/domain"
import { floorUtilization } from "@compass/physics"
import { cargoColor } from "@/lib/format"
import type { PlanItemView, PlanUnitView, PlanView } from "@/lib/plan-view"
import { parseContour, resolveEquipmentContour } from "@/lib/uld-contour"

type DbPlan = {
  seed: number
  settings?: unknown
  summary: unknown
  instances: {
    sequence: number
    equipmentTypeId: string
    metrics: unknown
    equipmentType: {
      id: string
      name: string
      mode: string
      oogClass: string
      heightOpen: boolean
      contour: unknown
      innerLengthCm: number
      innerWidthCm: number
      innerHeightCm: number
      maxPayloadKg: number
      tareKg?: number
    }
    placements: {
      cargoItemId: string
      instanceIndex: number
      xCm: number
      yCm: number
      zCm: number
      lengthCm: number
      widthCm: number
      heightCm: number
      rotation: string
      cargoItem: {
        name: string
        sku?: string | null
        weightKg: number
        color: string | null
        shape: string
        stackable?: boolean
        bottomOnly?: boolean
        maxStackLoadKg?: number | null
      }
    }[]
  }[]
  unloaded: {
    cargoItemId: string
    reasonCode: string
    reasonDetail: string | null
    cargoItem: { name: string }
  }[]
}

/**
 * A saved plan as the screens use it. Anything the plan was saved with that no longer has a meaning
 * (older versions kept handling-clearance settings and extra floor figures in the same JSON) is
 * simply not read, so those plans open exactly like any other. Floor utilization is worked out from
 * the saved positions every time, so plans saved before it was exact show the exact figure too.
 */
export function planFromDb(plan: DbPlan): PlanView {
  const summary = asRecord(plan.summary)
  const settings = asRecord(plan.settings)
  return {
    layoutSource: settings.layoutSource === "MANUAL" ? "MANUAL" : "AUTO",
    seed: plan.seed,
    elapsedMs: numberOf(summary.elapsedMs, 0),
    totalCost: numberOf(summary.totalCost, 0),
    warnings: Array.isArray(summary.warnings) ? summary.warnings.filter((row): row is string => typeof row === "string") : [],
    units: plan.instances
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((instance, index) => unitFromInstance(instance, index)),
    unloaded: plan.unloaded.map((row) => ({
      cargoId: row.cargoItemId,
      name: row.cargoItem.name,
      reason: row.reasonCode,
      detail: row.reasonDetail ?? "",
    })),
  }
}

function unitFromInstance(instance: DbPlan["instances"][number], index: number): PlanUnitView {
  const metrics = asRecord(instance.metrics)
  const cog = asRecord(metrics.cog)
  const axleLoads = Array.isArray(metrics.axleLoads) ? metrics.axleLoads : []
  const items: PlanItemView[] = instance.placements.map((placement, itemIndex) => ({
    id: `${placement.cargoItemId}-${placement.instanceIndex}`,
    cargoId: placement.cargoItemId,
    name: placement.cargoItem.name,
    sku: placement.cargoItem.sku ?? null,
    color: cargoColor(placement.cargoItem.name, placement.cargoItem.color),
    x: placement.xCm,
    y: placement.yCm,
    z: placement.zCm,
    lengthCm: placement.lengthCm,
    widthCm: placement.widthCm,
    heightCm: placement.heightCm,
    weightKg: placement.cargoItem.weightKg,
    sequence: itemIndex + 1,
    rotation: placement.rotation,
    shape: cargoShapeSchema.safeParse(placement.cargoItem.shape).success ? cargoShapeSchema.parse(placement.cargoItem.shape) : "BOX",
    stackable: placement.cargoItem.stackable,
    bottomOnly: placement.cargoItem.bottomOnly,
    maxStackLoadKg: placement.cargoItem.maxStackLoadKg ?? null,
  }))
  const floor = floorUtilization(
    items.map((item) => ({ x: item.x, y: item.y, z: item.z, l: item.lengthCm, w: item.widthCm, h: item.heightCm })),
    { lengthCm: instance.equipmentType.innerLengthCm, widthCm: instance.equipmentType.innerWidthCm },
  )
  return {
    unitIndex: index,
    equipmentId: instance.equipmentTypeId,
    equipmentName: instance.equipmentType.name,
    equipmentMode: equipmentModeSchema.safeParse(instance.equipmentType.mode).success
      ? equipmentModeSchema.parse(instance.equipmentType.mode)
      : "SEA",
    oogClass: oogClassSchema.safeParse(instance.equipmentType.oogClass).success
      ? oogClassSchema.parse(instance.equipmentType.oogClass)
      : "NONE",
    heightOpen: instance.equipmentType.heightOpen,
    contour: resolveEquipmentContour(instance.equipmentType.name, parseContour(instance.equipmentType.contour)),
    lengthCm: instance.equipmentType.innerLengthCm,
    widthCm: instance.equipmentType.innerWidthCm,
    heightCm: instance.equipmentType.innerHeightCm,
    maxPayloadKg: instance.equipmentType.maxPayloadKg,
    pieces: numberOf(metrics.pieces, instance.placements.length),
    netKg: numberOf(metrics.netKg, 0),
    grossKg: numberOf(metrics.grossKg, 0),
    volumeM3: numberOf(metrics.volumeM3, 0),
    volumePct: numberOf(metrics.volumePct, 0),
    // From the saved positions, not from a stored figure: older plans stored a grid-rounded one, and
    // plans saved by an earlier version also stored an "effective" figure that no longer exists.
    floorPct: Math.round(floor.pct * 10) / 10,
    weightPct: numberOf(metrics.weightPct, 0),
    remainingKg: numberOf(metrics.remainingKg, instance.equipmentType.maxPayloadKg - numberOf(metrics.netKg, 0)),
    remainingM3: numberOf(
      metrics.remainingM3,
      (instance.equipmentType.innerLengthCm * instance.equipmentType.innerWidthCm * instance.equipmentType.innerHeightCm) / 1_000_000 -
        numberOf(metrics.volumeM3, 0),
    ),
    tareKg: Math.round((numberOf(metrics.grossKg, 0) - numberOf(metrics.netKg, 0)) * 10) / 10,
    usedLengthCm: numberOf(metrics.usedLengthCm, 0),
    usedWidthCm: numberOf(metrics.usedWidthCm, 0),
    usedHeightCm: numberOf(metrics.usedHeightCm, 0),
    cog: {
      x: numberOf(cog.x, instance.equipmentType.innerLengthCm / 2),
      y: numberOf(cog.y, instance.equipmentType.innerWidthCm / 2),
      z: numberOf(cog.z, 0),
    },
    axleLoads: axleLoads.flatMap((row) => {
      const axle = asRecord(row)
      if (typeof axle.name !== "string") return []
      return [
        {
          name: axle.name,
          kg: numberOf(axle.kg, 0),
          maxKg: numberOf(axle.maxKg, 0),
          positionFromFrontCm: numberOf(axle.positionFromFrontCm, 0),
        },
      ]
    }),
    items,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

