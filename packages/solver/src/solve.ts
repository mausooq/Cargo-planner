import { snapBoxToContour } from "./contour"
import { orientationsFor } from "./geometry"
import { createRng, type Rng } from "./rng"
import type {
  PlannedUnit,
  SolverCargo,
  SolverEquipment,
  SolverInput,
  SolverProgress,
  SolverResult,
  SolverSettings,
  UnloadedItem,
} from "./types"
import { Unit, type Instance, type Rejection } from "./unit"

export const DEFAULT_SETTINGS: SolverSettings = {
  seed: 1,
  restarts: 24,
  timeLimitMs: 5000,
  objective: "FEWEST_UNITS",
  heavierBelow: true,
  minSupportRatio: 0.75,
  keepConsignmentsTogether: true,
  segregation: [],
}

type Candidate = {
  units: PlannedUnit[]
  unloaded: UnloadedItem[]
  totalCost: number
}

type Ordering = (a: Instance, b: Instance) => number

export function solve(
  input: SolverInput,
  onProgress?: (progress: SolverProgress) => void,
  shouldStop?: () => boolean,
): SolverResult {
  const started = now()
  const settings: SolverSettings = { ...DEFAULT_SETTINGS, ...stripUndefined(input.settings ?? {}) }
  const warnings: string[] = []
  const equipment = input.equipment.filter((type) => type.maxCount === null || type.maxCount > 0)
  if (equipment.length === 0) warnings.push("No equipment was selected.")

  const { feasible, unloaded: infeasible } = splitInfeasible(input.cargo, equipment)
  const rng = createRng(settings.seed)
  const orderings = buildOrderings(settings)

  let best: Candidate | null = null
  let restartsRun = 0
  for (let restart = 0; restart < Math.max(1, settings.restarts); restart += 1) {
    if (restart > 0 && now() - started > settings.timeLimitMs) break
    if (shouldStop?.()) break
    const ordering = orderings[restart % orderings.length] as Ordering
    let ordered = feasible.slice().sort(ordering)
    if (restart >= orderings.length) ordered = perturb(ordered, rng)
    const candidate = packAll(ordered, equipment, settings, infeasible)
    restartsRun += 1
    if (!best || better(candidate, best, settings)) best = candidate
    onProgress?.({
      restart: restart + 1,
      restarts: settings.restarts,
      bestUnits: best.units.length,
      bestUnloaded: best.unloaded.length,
    })
    if (best.unloaded.length === 0 && best.units.length <= 1) break
    // Every piece is too big for every unit: reordering cannot change the outcome.
    if (feasible.length === 0) break
  }

  const final = best ?? { units: [], unloaded: infeasible, totalCost: 0 }
  if (final.unloaded.length > 0) {
    warnings.push(`${final.unloaded.length} piece(s) do not fit in the selected container.`)
  }
  for (const unit of final.units) {
    for (const load of unit.metrics.axleLoads) {
      if (load.kg > load.maxKg) warnings.push(`Unit ${unit.unitIndex + 1}: ${load.name} is over its limit.`)
    }
  }

  return {
    units: final.units,
    unloaded: final.unloaded,
    warnings,
    totalCost: final.totalCost,
    seed: settings.seed,
    restartsRun,
    elapsedMs: Math.round(now() - started),
    settings,
  }
}

function packAll(
  ordered: Instance[],
  equipment: SolverEquipment[],
  settings: SolverSettings,
  presetUnloaded: UnloadedItem[],
): Candidate {
  const typeOrder = equipment.slice().sort((a, b) => typeRank(a, settings) - typeRank(b, settings))
  const used = new Map<string, number>()
  const units: Unit[] = []
  const unloaded: UnloadedItem[] = presetUnloaded.slice()
  let remaining = ordered

  while (remaining.length > 0) {
    const type = typeOrder.find((candidate) => available(candidate, used) > 0)
    if (!type) {
      for (const instance of remaining) {
        unloaded.push({
          cargoId: instance.cargo.id,
          instanceIndex: instance.instanceIndex,
          reason: "NO_SPACE",
          detail: "Does not fit in the selected container.",
        })
      }
      break
    }

    const unit = new Unit(type, settings)
    const { left, lastRejection } = fill(unit, remaining)
    if (unit.count === 0) {
      // This type could not take the next item. Try another type before giving up on it.
      const alternative = typeOrder.find((candidate) => candidate !== type && available(candidate, used) > 0 && canTakeAny(candidate, remaining, settings))
      if (alternative) {
        const altUnit = new Unit(alternative, settings)
        const altFill = fill(altUnit, remaining)
        if (altUnit.count > 0) {
          used.set(alternative.id, (used.get(alternative.id) ?? 0) + 1)
          units.push(altUnit)
          remaining = altFill.left
          continue
        }
      }
      const head = remaining[0] as Instance
      unloaded.push({
        cargoId: head.cargo.id,
        instanceIndex: head.instanceIndex,
        reason: lastRejection?.reason ?? "NO_SPACE",
        detail: lastRejection?.detail ?? "No unit could take this piece.",
      })
      remaining = remaining.slice(1)
      continue
    }
    used.set(type.id, (used.get(type.id) ?? 0) + 1)
    units.push(unit)
    remaining = left
  }

  const downsized = downsize(units, equipment, used, settings)
  const planned = downsized.map((unit, index) => ({
    unitIndex: index,
    equipmentId: unit.equipment.id,
    placements: unit.placements(index),
    metrics: unit.metrics(),
  }))
  const totalCost = downsized.reduce((sum, unit) => sum + unit.equipment.costPerUnit, 0)
  return { units: planned, unloaded, totalCost }
}

function fill(unit: Unit, instances: Instance[]): { left: Instance[]; lastRejection: Rejection | null } {
  const left: Instance[] = []
  let lastRejection: Rejection | null = null
  for (const instance of instances) {
    const rejection = unit.tryPlace(instance)
    if (rejection) {
      lastRejection = rejection
      left.push(instance)
    }
  }
  return { left, lastRejection }
}

/** Swap the last unit for the cheapest or smallest type that still holds everything in it. */
function downsize(units: Unit[], equipment: SolverEquipment[], used: Map<string, number>, settings: SolverSettings): Unit[] {
  if (units.length === 0) return units
  const lastIndex = units.length - 1
  const last = units[lastIndex] as Unit
  const instances = last.placed.map((item) => item.instance)
  const improves = (type: SolverEquipment) =>
    settings.objective === "LOWEST_COST"
      ? type.costPerUnit < last.equipment.costPerUnit
      : volumeOf(type) < volumeOf(last.equipment) ||
        (volumeOf(type) === volumeOf(last.equipment) && type.costPerUnit < last.equipment.costPerUnit)
  const candidates = equipment
    .filter((type) => type.id !== last.equipment.id && available(type, used) > 0 && improves(type))
    .sort((a, b) =>
      settings.objective === "LOWEST_COST" ? a.costPerUnit - b.costPerUnit : volumeOf(a) - volumeOf(b),
    )
  for (const type of candidates) {
    const trial = new Unit(type, settings)
    const { left } = fill(trial, instances)
    if (left.length === 0) {
      const next = units.slice()
      next[lastIndex] = trial
      return next
    }
  }
  return units
}

function volumeOf(type: SolverEquipment): number {
  return type.lengthCm * type.widthCm * type.heightCm
}

function canTakeAny(type: SolverEquipment, instances: Instance[], settings: SolverSettings): boolean {
  const trial = new Unit(type, settings)
  for (const instance of instances.slice(0, 5)) {
    if (trial.tryPlace(instance) === null) return true
  }
  return false
}

function available(type: SolverEquipment, used: Map<string, number>): number {
  if (type.maxCount === null) return Number.POSITIVE_INFINITY
  return type.maxCount - (used.get(type.id) ?? 0)
}

/** Lower rank is tried first. Fewest units: biggest first. Lowest cost: cheapest per cubic metre first. */
function typeRank(type: SolverEquipment, settings: SolverSettings): number {
  const vol = type.lengthCm * type.widthCm * type.heightCm
  if (settings.objective === "LOWEST_COST") {
    return vol > 0 ? type.costPerUnit / vol : Number.POSITIVE_INFINITY
  }
  return -vol
}

function better(candidate: Candidate, incumbent: Candidate, settings: SolverSettings): boolean {
  if (candidate.unloaded.length !== incumbent.unloaded.length) {
    return candidate.unloaded.length < incumbent.unloaded.length
  }
  const candidateScore = settings.objective === "LOWEST_COST" ? candidate.totalCost : candidate.units.length
  const incumbentScore = settings.objective === "LOWEST_COST" ? incumbent.totalCost : incumbent.units.length
  if (candidateScore !== incumbentScore) return candidateScore < incumbentScore
  return averageVolume(candidate) > averageVolume(incumbent) + 1e-9
}

function averageVolume(candidate: Candidate): number {
  if (candidate.units.length === 0) return 0
  return candidate.units.reduce((sum, unit) => sum + unit.metrics.volumePct, 0) / candidate.units.length
}

function buildOrderings(settings: SolverSettings): Ordering[] {
  const head = (a: Instance, b: Instance): number => {
    // Last drop loads first and ends up at the front. First drop is loaded last, by the doors.
    if (a.cargo.destinationStop !== b.cargo.destinationStop) return b.cargo.destinationStop - a.cargo.destinationStop
    if (a.cargo.priority !== b.cargo.priority) return b.cargo.priority - a.cargo.priority
    if (settings.keepConsignmentsTogether) {
      const left = a.cargo.consignmentId ?? ""
      const right = b.cargo.consignmentId ?? ""
      if (left !== right) return left < right ? -1 : 1
    }
    return 0
  }
  const vol = (i: Instance) => i.cargo.lengthCm * i.cargo.widthCm * i.cargo.heightCm
  const area = (i: Instance) => i.cargo.lengthCm * i.cargo.widthCm
  const tie = (a: Instance, b: Instance) =>
    a.cargo.id === b.cargo.id ? a.instanceIndex - b.instanceIndex : a.cargo.id < b.cargo.id ? -1 : 1
  return [
    (a, b) => head(a, b) || vol(b) - vol(a) || tie(a, b),
    (a, b) => head(a, b) || b.cargo.weightKg - a.cargo.weightKg || tie(a, b),
    (a, b) => head(a, b) || area(b) - area(a) || b.cargo.heightCm - a.cargo.heightCm || tie(a, b),
    (a, b) => head(a, b) || b.cargo.heightCm - a.cargo.heightCm || vol(b) - vol(a) || tie(a, b),
    (a, b) => head(a, b) || Math.max(b.cargo.lengthCm, b.cargo.widthCm) - Math.max(a.cargo.lengthCm, a.cargo.widthCm) || tie(a, b),
  ]
}

/** Small local shuffles that keep destination and priority blocks intact. */
function perturb(ordered: Instance[], rng: Rng): Instance[] {
  const copy = ordered.slice()
  // Nothing to swap. Without this guard an empty list reads copy[-1] and crashes.
  if (copy.length < 2) return copy
  const swaps = Math.max(1, Math.floor(copy.length / 4))
  for (let count = 0; count < swaps; count += 1) {
    const index = rng.int(Math.max(1, copy.length - 1))
    const other = Math.min(copy.length - 1, index + 1 + rng.int(3))
    const a = copy[index] as Instance
    const b = copy[other] as Instance
    if (a.cargo.destinationStop !== b.cargo.destinationStop || a.cargo.priority !== b.cargo.priority) continue
    copy[index] = b
    copy[other] = a
  }
  return copy
}

function splitInfeasible(cargo: SolverCargo[], equipment: SolverEquipment[]): { feasible: Instance[]; unloaded: UnloadedItem[] } {
  const feasible: Instance[] = []
  const unloaded: UnloadedItem[] = []
  for (const item of cargo) {
    const dims = orientationsFor(item)
    const emptyFits = (type: SolverEquipment) =>
      dims.some((dim) =>
        snapBoxToContour(
          { x: 0, y: 0, z: 0, l: type.lengthCm, w: type.widthCm, h: type.heightCm },
          dim,
          type,
        ),
      )
    const fitsSomewhere = equipment.some(emptyFits)
    const lightEnough = equipment.some((type) => item.weightKg <= type.maxPayloadKg)
    for (let index = 0; index < item.quantity; index += 1) {
      if (equipment.length === 0) {
        unloaded.push({ cargoId: item.id, instanceIndex: index, reason: "EQUIPMENT_RESTRICTION", detail: "No equipment selected." })
      } else if (!fitsSomewhere) {
        unloaded.push({ cargoId: item.id, instanceIndex: index, reason: "OUT_OF_GAUGE", detail: `${item.name} is larger than every selected unit.` })
      } else if (!lightEnough) {
        unloaded.push({ cargoId: item.id, instanceIndex: index, reason: "TOO_HEAVY", detail: `${item.name} is heavier than every selected payload.` })
      } else {
        feasible.push({ cargo: item, instanceIndex: index })
      }
    }
  }
  return { feasible, unloaded }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key]
  }
  return out
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}
