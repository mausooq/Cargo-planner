import { z } from "zod"

export const EQUIPMENT_MODES = ["SEA", "AIR", "ROAD", "PALLET"] as const
export const equipmentModeSchema = z.enum(EQUIPMENT_MODES)
export type EquipmentMode = z.infer<typeof equipmentModeSchema>

export const ROLES = ["ADMIN", "PLANNER", "VIEWER"] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

export const OOG_CLASSES = ["NONE", "FLATBED", "STEPDECK", "LOWBOY", "OPEN_TOP"] as const
export const oogClassSchema = z.enum(OOG_CLASSES)
export type OogClass = z.infer<typeof oogClassSchema>

export const CARGO_SHAPES = ["BOX", "CYLINDER_DRUM", "PIPE"] as const
export const cargoShapeSchema = z.enum(CARGO_SHAPES)
export type CargoShape = z.infer<typeof cargoShapeSchema>

export const ORIENTATIONS = ["FIXED", "LONGSHIP", "ROTATE_90", "TILTABLE", "ANY", "CUSTOM"] as const
export const orientationSchema = z.enum(ORIENTATIONS)
export type Orientation = z.infer<typeof orientationSchema>

/** Axis order is length × width × height after the turn. Bits match the custom dialog value. */
export const AXIS_ROTATIONS = ["LWH", "WLH", "LHW", "HLW", "HWL", "WHL"] as const
export const axisRotationSchema = z.enum(AXIS_ROTATIONS)
export type AxisRotation = z.infer<typeof axisRotationSchema>

export const AXIS_ROTATION_BITS: Record<AxisRotation, number> = {
  LWH: 1,
  WLH: 2,
  LHW: 4,
  HLW: 8,
  HWL: 16,
  WHL: 32,
}

export function orientationMask(codes: readonly AxisRotation[]): number {
  return codes.reduce((sum, code) => sum + AXIS_ROTATION_BITS[code], 0)
}

export function presetRotations(orientation: Orientation): AxisRotation[] {
  if (orientation === "LONGSHIP" || orientation === "FIXED") return ["LWH"]
  if (orientation === "ROTATE_90") return ["LWH", "WLH"]
  return [...AXIS_ROTATIONS]
}

export function parseAllowedRotations(raw: string | null | undefined): AxisRotation[] | null {
  if (!raw?.trim()) return null
  const codes = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is AxisRotation => axisRotationSchema.safeParse(part).success)
  return codes.length > 0 ? codes : null
}

export function formatAllowedRotations(codes: readonly AxisRotation[] | null | undefined): string | null {
  if (!codes || codes.length === 0) return null
  return codes.join(",")
}

export const OBJECTIVES = ["FEWEST_UNITS", "LOWEST_COST"] as const
export const objectiveSchema = z.enum(OBJECTIVES)
export type Objective = z.infer<typeof objectiveSchema>

export const UNLOADED_REASONS = [
  "NO_SPACE",
  "TOO_HEAVY",
  "AXLE_LIMIT",
  "ORIENTATION",
  "STACK_RULE",
  "SEGREGATION",
  "EQUIPMENT_RESTRICTION",
  "OUT_OF_GAUGE",
  "CLEARANCE",
] as const
export const unloadedReasonSchema = z.enum(UNLOADED_REASONS)
export type UnloadedReason = z.infer<typeof unloadedReasonSchema>

/** Internal storage is centimetres and kilograms. Convert only at the UI edge. */
export const UNITS = { length: "cm", weight: "kg" } as const

/**
 * Origin is the front-left floor corner.
 * x grows toward the doors, y grows across the width, z grows upward.
 */
export const COORDINATE_SYSTEM = {
  x: "Centimetres from the front bulkhead toward the doors.",
  y: "Centimetres across the width from the left wall.",
  z: "Centimetres up from the floor.",
} as const

export const axleGroupSchema = z.object({
  name: z.string().trim().min(1),
  positionFromFrontCm: z.number().nonnegative(),
  maxKg: z.number().positive(),
})
export type AxleGroup = z.infer<typeof axleGroupSchema>

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

export const uldSideContourSchema = z.object({
  lengthMm: z.number().nonnegative(),
  heightMm: z.number().nonnegative(),
})

export const equipmentContourSchema = z.object({
  bottomLeft: uldSideContourSchema,
  bottomRight: uldSideContourSchema,
  topLeft: uldSideContourSchema,
  topRight: uldSideContourSchema,
})
export type EquipmentContour = z.infer<typeof equipmentContourSchema>

export const equipmentSeedSchema = z.object({
  externalId: z.string().trim().min(1),
  mode: equipmentModeSchema,
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  sizeLabel: z.string().trim().min(1).nullable(),
  innerLengthCm: z.number().positive(),
  innerWidthCm: z.number().positive(),
  innerHeightCm: z.number().positive(),
  heightOpen: z.boolean(),
  maxPayloadKg: z.number().positive(),
  tareKg: z.number().nonnegative(),
  floors: z.number().int().positive(),
  axleGroups: z.array(axleGroupSchema),
  costPerUnit: z.number().nonnegative(),
  isCustom: z.boolean(),
  extendable: z.boolean(),
  maxExtendedLengthCm: z.number().positive().nullable(),
  oogClass: oogClassSchema,
  notes: z.string().nullable(),
  contour: equipmentContourSchema.nullable().optional(),
  doorWidthCm: z.number().positive().nullable().optional(),
  doorHeightCm: z.number().positive().nullable().optional(),
})
export type EquipmentSeed = z.infer<typeof equipmentSeedSchema>

export const PLANNER_STEPS = ["data", "setup", "workspace", "plan"] as const
export const plannerStepSchema = z.enum(PLANNER_STEPS)
export type PlannerStep = z.infer<typeof plannerStepSchema>

export const EQUIPMENT_ROLES = ["PRIMARY", "SECONDARY"] as const
export const equipmentRoleSchema = z.enum(EQUIPMENT_ROLES)
export type EquipmentRole = z.infer<typeof equipmentRoleSchema>

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(120, "Keep the name under 120 characters"),
  mode: equipmentModeSchema,
  etd: z.string().trim().min(1, "Pick the estimated departure date"),
  notes: z.string().trim().max(2000).optional(),
  objective: objectiveSchema,
})
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>

export const projectEquipmentChoiceSchema = z.object({
  equipmentTypeId: z.string().min(1),
  role: equipmentRoleSchema,
  maxCount: z.number().int().positive().nullable(),
})
export type ProjectEquipmentChoice = z.infer<typeof projectEquipmentChoiceSchema>

export const cargoItemInputSchema = z
  .object({
    sku: z.string().trim().max(80).nullable(),
    name: z.string().trim().max(120),
    lengthCm: z.number().nonnegative(),
    widthCm: z.number().nonnegative(),
    heightCm: z.number().nonnegative(),
    weightKg: z.number().nonnegative(),
    quantity: z.number().int().positive(),
    shape: cargoShapeSchema,
    orientation: orientationSchema,
    allowedRotations: z.array(axisRotationSchema).nullable(),
    stackable: z.boolean(),
    bottomOnly: z.boolean(),
    maxStackLoadKg: z.number().nonnegative().nullable(),
    maxStackLayers: z.number().int().positive().nullable(),
    priority: z.number().int(),
    destinationStop: z.number().int().positive(),
    consignmentId: z.string().trim().min(1).nullable(),
    segregationClass: z.string().trim().min(1).nullable(),
    color: z.string().trim().min(1).nullable(),
    /** Handling clearance override for this line, per side in cm. Null or missing: use the project default. The 100 cm limit here and in the sides below is MAX_CLEARANCE_CM (a test keeps them equal). */
    clearanceCm: z.number().nonnegative().max(100).nullable().optional(),
    /** Directional handling clearance for this line (cm), in the orientation it was entered in. Takes the place of `clearanceCm`. */
    clearanceSides: z
      .object({
        front: z.number().nonnegative().max(100),
        rear: z.number().nonnegative().max(100),
        left: z.number().nonnegative().max(100),
        right: z.number().nonnegative().max(100),
      })
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.orientation === "CUSTOM" && (!value.allowedRotations || value.allowedRotations.length === 0)) {
      ctx.addIssue({ code: "custom", message: "Pick at least one orientation.", path: ["allowedRotations"] })
    }
  })
export type CargoItemInput = z.infer<typeof cargoItemInputSchema>

export const ruleSelectorSchema = z.object({
  nameContains: z.string().optional(),
  segregationClass: z.string().optional(),
  consignmentId: z.string().optional(),
  minWeightKg: z.number().nonnegative().optional(),
  maxWeightKg: z.number().nonnegative().optional(),
  minLengthCm: z.number().nonnegative().optional(),
})

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MUST_TOUCH_REAR") }),
  z.object({ type: z.literal("MUST_LOAD_FIRST") }),
  z.object({ type: z.literal("ONLY_EQUIPMENT"), equipmentCodes: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("ONLY_ON_ITEM"), targetName: z.string().min(1) }),
  z.object({ type: z.literal("NO_STACK") }),
])

export const customRuleSchema = z.object({
  id: z.string().min(1),
  selector: ruleSelectorSchema,
  action: ruleActionSchema,
})
export type CustomRule = z.infer<typeof customRuleSchema>

const CONTOUR_SIDES = ["bottomLeft", "bottomRight", "topLeft", "topRight"] as const

export const equipmentWriteSchema = z
  .object({
    id: z.string().min(1).optional(),
    mode: equipmentModeSchema,
    name: z.string().trim().min(1).max(160),
    innerLengthCm: z.number().positive(),
    innerWidthCm: z.number().positive(),
    innerHeightCm: z.number().positive(),
    heightOpen: z.boolean(),
    maxPayloadKg: z.number().positive(),
    tareKg: z.number(),
    doorWidthCm: z.number().positive().nullable(),
    doorHeightCm: z.number().positive().nullable(),
    oogClass: oogClassSchema,
    notes: z.string().trim().max(2000).nullable(),
    contour: equipmentContourSchema,
  })
  .superRefine((value, ctx) => {
    if (value.tareKg < 0) {
      ctx.addIssue({ code: "custom", message: "Tare must be 0 kg or more.", path: ["tareKg"] })
    }
    if (value.doorWidthCm != null && value.doorWidthCm > value.innerWidthCm) {
      ctx.addIssue({
        code: "custom",
        message: "Door width must be within the interior width.",
        path: ["doorWidthCm"],
      })
    }
    if (value.doorHeightCm != null && value.doorHeightCm > value.innerHeightCm) {
      ctx.addIssue({
        code: "custom",
        message: "Door height must be within the interior height.",
        path: ["doorHeightCm"],
      })
    }
    for (const side of CONTOUR_SIDES) {
      const heightCm = value.contour[side].heightMm / 10
      if (heightCm > value.innerHeightCm) {
        ctx.addIssue({
          code: "custom",
          message: "Contour height must be within the interior height.",
          path: ["contour", side, "heightMm"],
        })
      }
    }
  })
export type EquipmentWriteInput = z.infer<typeof equipmentWriteSchema>

export function equipmentWriteSchemaFor(takenNames: readonly string[]) {
  return equipmentWriteSchema.superRefine((value, ctx) => {
    const needle = value.name.trim().toLowerCase()
    if (takenNames.some((name) => name.trim().toLowerCase() === needle)) {
      ctx.addIssue({
        code: "custom",
        message: "That name is already used in this organisation.",
        path: ["name"],
      })
    }
  })
}

export function equipmentFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "form"
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

export function canEditProjects(role: Role): boolean {
  return role === "ADMIN" || role === "PLANNER"
}

export function canManageEquipment(role: Role): boolean {
  return role === "ADMIN"
}

export function canDeleteProjects(role: Role): boolean {
  return role === "ADMIN"
}

export function modeLabel(mode: EquipmentMode): string {
  if (mode === "SEA") return "Sea"
  if (mode === "AIR") return "Air"
  if (mode === "ROAD") return "Road"
  return "Pallets"
}

export function roleLabel(role: Role): string {
  if (role === "ADMIN") return "Admin"
  if (role === "PLANNER") return "Planner"
  return "Viewer"
}

/* ---------- Departure dates ---------- */

/** "YYYY-MM-DD" for a date in local time (not UTC, so late evening doesn't count as tomorrow). */
export function localIsoDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const ETD_IN_PAST_MESSAGE = "ETD can't be in the past. Pick today or a later date."

/** Strict check for forms: the date is before today on this device. */
export function isPastEtd(iso: string, now: Date = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso < localIsoDate(now)
}

/**
 * Server check. Allows one day of slack because the server's "today" can be a day ahead of the
 * user's (different time zones); the form already enforces the user's own today.
 */
export function isPastEtdOnServer(iso: string, now: Date = new Date()): boolean {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso < localIsoDate(yesterday)
}

/** The New project form's schema: the shared rules plus "ETD is today or later" on this device. */
export const projectCreateFormSchema = projectCreateSchema.refine((value) => !isPastEtd(value.etd), {
  message: ETD_IN_PAST_MESSAGE,
  path: ["etd"],
})
