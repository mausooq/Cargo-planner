import {
  DEFAULT_WORLD,
  type CylinderAxis,
  type DropPiece,
  type PhysicsWorld,
  type Vec3,
} from "@compass/physics"
import { itemSides } from "@/lib/clearance"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

export function cylinderAxisOf(item: PlanItemView): CylinderAxis {
  if (item.shape === "PIPE") return item.lengthCm >= item.widthCm ? "x" : "y"
  return "z"
}

export function itemToPiece(item: PlanItemView): DropPiece {
  return {
    id: item.id,
    name: item.name,
    shape: item.shape === "BOX" ? "box" : "cylinder",
    cx: item.x + item.lengthCm / 2,
    cy: item.y + item.widthCm / 2,
    cz: item.z + item.heightCm / 2,
    hx: item.lengthCm / 2,
    hy: item.widthCm / 2,
    hz: item.heightCm / 2,
    yawRad: 0,
    cylinderAxis: cylinderAxisOf(item),
    massKg: item.weightKg,
    stackable: item.stackable,
    bottomOnly: item.bottomOnly,
    maxStackLoadKg: item.maxStackLoadKg,
    clearance: itemSides(item),
  }
}

export function unitToWorld(unit: Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm">): PhysicsWorld {
  return {
    ...DEFAULT_WORLD,
    lengthCm: unit.lengthCm,
    widthCm: unit.widthCm,
    heightCm: unit.heightCm,
  }
}

export function applyDropPosition(item: PlanItemView, position: Vec3): PlanItemView {
  return { ...item, x: position.x, y: position.y, z: position.z }
}

export function pointerInFootprint(x: number, y: number, unit: Pick<PlanUnitView, "lengthCm" | "widthCm">): boolean {
  return x >= 0 && x <= unit.lengthCm && y >= 0 && y <= unit.widthCm
}
