import type { AxleGroup, EquipmentMode, OogClass } from "@compass/domain"

/**
 * Editable planning defaults applied when the workbook is seeded.
 * Certified ratings are not in the source sheet. See docs/ASSUMPTIONS.md.
 */
export const OPEN_HEIGHT_CM = {
  road: 270,
  air: 160,
  euroAndGmaPallet: 120,
  seaOpen: 270,
  palletPlatform: 270,
} as const

export const EU_BOX_TRAILER = {
  externalId: "11",
  maxPayloadKg: 24000,
  tareKg: 7000,
  costPerUnit: 950,
  axleGroups: [
    { name: "Kingpin", positionFromFrontCm: 160, maxKg: 12000 },
    { name: "Rear tandem", positionFromFrontCm: 1180, maxKg: 18000 },
  ],
} as const satisfies {
  externalId: string
  maxPayloadKg: number
  tareKg: number
  costPerUnit: number
  axleGroups: readonly AxleGroup[]
}

type PayloadSpec = {
  maxPayloadKg: number
  tareKg: number
  costPerUnit?: number
  floors?: number
}

const PAYLOAD_BY_KEY: Record<string, PayloadSpec> = {
  "SEA:1": { maxPayloadKg: 21770, tareKg: 2300, costPerUnit: 850 },
  "SEA:2": { maxPayloadKg: 26680, tareKg: 3780, costPerUnit: 1200 },
  "SEA:3": { maxPayloadKg: 26460, tareKg: 3900, costPerUnit: 1350 },
  "SEA:24": { maxPayloadKg: 25600, tareKg: 4800, costPerUnit: 1550 },
  "SEA:1167": { maxPayloadKg: 20800, tareKg: 3080, costPerUnit: 1650 },
  "SEA:7010": { maxPayloadKg: 26600, tareKg: 4480, costPerUnit: 2100 },
  "SEA:241": { maxPayloadKg: 25900, tareKg: 4900, costPerUnit: 2300 },
  "SEA:4": { maxPayloadKg: 21700, tareKg: 2350, costPerUnit: 900 },
  "SEA:5": { maxPayloadKg: 26600, tareKg: 4000, costPerUnit: 1250 },
  "SEA:6": { maxPayloadKg: 21000, tareKg: 2740, costPerUnit: 1100 },
  "SEA:7": { maxPayloadKg: 26500, tareKg: 5000, costPerUnit: 1500 },
  "SEA:25": { maxPayloadKg: 30000, tareKg: 4200, costPerUnit: 1400 },
  "SEA:1215": { maxPayloadKg: 26200, tareKg: 4300, costPerUnit: 1450 },
  "SEA:15336": { maxPayloadKg: 25000, tareKg: 3500, costPerUnit: 700 },
  "SEA:15335": { maxPayloadKg: 100000, tareKg: 12000, costPerUnit: 1800 },
  "SEA:979": { maxPayloadKg: 28000, tareKg: 5200, costPerUnit: 1600 },
  "SEA:15334": { maxPayloadKg: 100000, tareKg: 14000, costPerUnit: 2200 },
  "SEA:15333": { maxPayloadKg: 80000, tareKg: 15000, costPerUnit: 2400 },
  "SEA:13333": { maxPayloadKg: 21770, tareKg: 4000, costPerUnit: 900 },
  "SEA:13332": { maxPayloadKg: 26460, tareKg: 5500, costPerUnit: 1400 },

  "ROAD:11": {
    maxPayloadKg: EU_BOX_TRAILER.maxPayloadKg,
    tareKg: EU_BOX_TRAILER.tareKg,
    costPerUnit: EU_BOX_TRAILER.costPerUnit,
  },
  "ROAD:185": { maxPayloadKg: 24000, tareKg: 6800, costPerUnit: 940 },
  "ROAD:216": { maxPayloadKg: 26000, tareKg: 7800, costPerUnit: 1100 },
  "ROAD:1079": { maxPayloadKg: 24000, tareKg: 6200, costPerUnit: 880 },
  "ROAD:4142": { maxPayloadKg: 19958, tareKg: 6400, costPerUnit: 1000 },
  "ROAD:1080": { maxPayloadKg: 20412, tareKg: 6800, costPerUnit: 1050 },
  "ROAD:4323": { maxPayloadKg: 21772, tareKg: 5000, costPerUnit: 980 },
  "ROAD:1076": { maxPayloadKg: 21772, tareKg: 5400, costPerUnit: 1020 },
  "ROAD:1075": { maxPayloadKg: 19504, tareKg: 6200, costPerUnit: 1150 },
  "ROAD:1078": { maxPayloadKg: 36287, tareKg: 9000, costPerUnit: 1600 },
  "ROAD:978": { maxPayloadKg: 27216, tareKg: 5500, costPerUnit: 1200 },
  "ROAD:299": { maxPayloadKg: 22000, tareKg: 9500, costPerUnit: 1400, floors: 2 },
  "ROAD:15471": { maxPayloadKg: 4536, tareKg: 4500, costPerUnit: 620 },
  "ROAD:1773": { maxPayloadKg: 24000, tareKg: 7000, costPerUnit: 900 },
  "ROAD:1772": { maxPayloadKg: 34000, tareKg: 10000, costPerUnit: 1500 },
  "ROAD:1129": { maxPayloadKg: 18000, tareKg: 6000, costPerUnit: 800 },
  "ROAD:1130": { maxPayloadKg: 18000, tareKg: 6200, costPerUnit: 820 },
  "ROAD:484": { maxPayloadKg: 14000, tareKg: 4500, costPerUnit: 700 },
  "ROAD:486": { maxPayloadKg: 22000, tareKg: 6500, costPerUnit: 980 },
  "ROAD:9": { maxPayloadKg: 8000, tareKg: 5500, costPerUnit: 700 },
  "ROAD:1403": { maxPayloadKg: 24000, tareKg: 7200, costPerUnit: 960 },
  "ROAD:13334": { maxPayloadKg: 21770, tareKg: 3200, costPerUnit: 750 },
  "ROAD:10": { maxPayloadKg: 18000, tareKg: 6500, costPerUnit: 860 },
  "ROAD:13335": { maxPayloadKg: 26460, tareKg: 4800, costPerUnit: 1100 },
  "ROAD:5320": { maxPayloadKg: 2000, tareKg: 1800, costPerUnit: 280 },
  "ROAD:5321": { maxPayloadKg: 5000, tareKg: 3500, costPerUnit: 420 },
  "ROAD:14269": { maxPayloadKg: 36287, tareKg: 11000, costPerUnit: 1800 },

  "PALLET:1293": { maxPayloadKg: 1500, tareKg: 25, costPerUnit: 12 },
  "PALLET:1294": { maxPayloadKg: 1361, tareKg: 20, costPerUnit: 14 },
  "PALLET:12123": { maxPayloadKg: 25000, tareKg: 800, costPerUnit: 240 },
  "PALLET:12106": { maxPayloadKg: 25000, tareKg: 1100, costPerUnit: 280 },
}

export type EquipmentPhysicsInput = {
  mode: EquipmentMode
  externalId: string
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number | null
}

export type EquipmentPhysics = {
  innerHeightCm: number
  heightOpen: boolean
  maxPayloadKg: number
  tareKg: number
  floors: number
  axleGroups: AxleGroup[]
  costPerUnit: number
  oogClass: OogClass
  extendable: boolean
  maxExtendedLengthCm: number | null
  notes: string | null
}

export function equipmentPhysics(input: EquipmentPhysicsInput): EquipmentPhysics {
  const key = `${input.mode}:${input.externalId}`
  const spec = PAYLOAD_BY_KEY[key]
  if (!spec && input.mode !== "AIR") {
    throw new Error(`Missing payload default for ${key} (${input.name}). Add it in src/lib/equipment-defaults.ts.`)
  }

  const payload = spec ?? airPayload(input.name, input.lengthCm)
  const heightOpen = input.heightCm === null
  const innerHeightCm = input.heightCm ?? openHeight(input.mode, input.name)
  const floors = payload.floors ?? (input.name.toLowerCase().includes("double deck trailer") ? 2 : 1)
  const axleGroups = axlesFor(input, payload.maxPayloadKg)
  const oogClass = inferOogClass(input.mode, input.name)
  const extendable = input.name.toLowerCase().includes("extendable")
  const maxExtendedLengthCm = extendable ? Math.round(input.lengthCm + 610) : null
  const costPerUnit = payload.costPerUnit ?? fallbackCost(input.mode, input.lengthCm, payload.maxPayloadKg)

  for (const axle of axleGroups) {
    if (axle.positionFromFrontCm <= 0 || axle.positionFromFrontCm >= input.lengthCm) {
      throw new Error(`Axle "${axle.name}" on ${input.name} sits outside the deck.`)
    }
  }

  const notes = buildNotes({
    input,
    innerHeightCm,
    heightOpen,
    floors,
    axleGroups,
    oogClass,
    extendable,
    maxExtendedLengthCm,
  })

  return {
    innerHeightCm,
    heightOpen,
    maxPayloadKg: payload.maxPayloadKg,
    tareKg: payload.tareKg,
    floors,
    axleGroups,
    costPerUnit,
    oogClass,
    extendable,
    maxExtendedLengthCm,
    notes,
  }
}

function openHeight(mode: EquipmentMode, name: string): number {
  if (mode === "AIR") return OPEN_HEIGHT_CM.air
  if (mode === "PALLET") {
    const normalized = name.toLowerCase()
    if (normalized.includes("euro") || normalized.includes("gma")) return OPEN_HEIGHT_CM.euroAndGmaPallet
    return OPEN_HEIGHT_CM.palletPlatform
  }
  if (mode === "ROAD") return OPEN_HEIGHT_CM.road
  return OPEN_HEIGHT_CM.seaOpen
}

function airPayload(name: string, lengthCm: number): PayloadSpec {
  const normalized = name.toLowerCase()
  if (normalized.includes("ld3-45") || normalized.includes("akh")) return { maxPayloadKg: 1134, tareKg: 82 }
  if (normalized.includes("ld-3") || normalized.includes("ake")) return { maxPayloadKg: 1508, tareKg: 82 }
  if (normalized.includes("ld-1") || normalized.includes("akc")) return { maxPayloadKg: 1508, tareKg: 80 }
  if (normalized.includes("ld-2")) return { maxPayloadKg: 1225, tareKg: 70 }
  if (normalized.includes("ld-11") || normalized.includes("alp")) return { maxPayloadKg: 3176, tareKg: 180 }
  if (normalized.includes("ld-8")) return { maxPayloadKg: 2449, tareKg: 130 }
  if (normalized.includes("ld-9") || normalized.includes("aap")) return { maxPayloadKg: 4626, tareKg: 220 }
  if (normalized.includes("ld-26") || normalized.includes("aaf")) return { maxPayloadKg: 6033, tareKg: 280 }
  if (normalized.includes("aan")) return { maxPayloadKg: 1588, tareKg: 230 }
  if (normalized.includes("cmp")) return { maxPayloadKg: 3175, tareKg: 160 }
  if (normalized.includes("a2n")) return { maxPayloadKg: 6033, tareKg: 480 }
  if (normalized.includes("pga")) return { maxPayloadKg: 11340, tareKg: 300 }
  if (normalized.includes("pla")) return { maxPayloadKg: 3175, tareKg: 90 }
  if (normalized.includes("pra") || normalized.includes("mdp")) return { maxPayloadKg: 6804, tareKg: 180 }
  if (normalized.includes("pyb")) return { maxPayloadKg: 2449, tareKg: 70 }
  if (normalized.includes("pmc") || normalized.includes("p6p")) return { maxPayloadKg: 6804, tareKg: 120 }
  if (normalized.includes("pag") || normalized.includes("paq") || normalized.includes("p1p")) {
    return { maxPayloadKg: 6033, tareKg: 110 }
  }
  if (lengthCm >= 480) return { maxPayloadKg: 6804, tareKg: 160 }
  return { maxPayloadKg: 1588, tareKg: 80 }
}

function fallbackCost(mode: EquipmentMode, lengthCm: number, payloadKg: number): number {
  if (mode === "PALLET") return lengthCm < 200 ? 15 : 250
  if (mode === "AIR") return Math.round(150 + payloadKg / 40)
  if (mode === "SEA") return Math.round(500 + lengthCm * 0.7)
  return Math.round(400 + lengthCm * 0.4)
}

function axlesFor(input: EquipmentPhysicsInput, payloadKg: number): AxleGroup[] {
  const name = input.name.toLowerCase()
  const chassis = name.includes("chassis")
  if (input.mode !== "ROAD" && !(input.mode === "SEA" && chassis)) return []

  if (input.mode === "ROAD" && input.externalId === EU_BOX_TRAILER.externalId) {
    return EU_BOX_TRAILER.axleGroups.map((group) => ({ ...group }))
  }

  if (input.mode === "ROAD" && isRigid(input.name)) {
    return rigidAxles(input.lengthCm, payloadKg)
  }

  return semiAxles(input.lengthCm, payloadKg)
}

function isRigid(name: string): boolean {
  const normalized = name.toLowerCase()
  if (
    normalized.includes("trailer") ||
    normalized.includes("chassis") ||
    normalized.includes("flatbed") ||
    normalized.includes("rgn")
  ) {
    return false
  }
  return normalized.includes("truck") || normalized.includes("van")
}

function semiAxles(lengthCm: number, payloadKg: number): AxleGroup[] {
  const kingpin = clamp(Math.round(lengthCm * 0.12), 80, 180)
  const rearInset = Math.min(220, Math.max(140, lengthCm * 0.14))
  const rear = clamp(Math.round(lengthCm - rearInset), kingpin + 100, lengthCm - 30)
  return [
    { name: "Kingpin", positionFromFrontCm: kingpin, maxKg: Math.round(payloadKg * 0.5) },
    { name: "Rear bogie", positionFromFrontCm: rear, maxKg: Math.round(payloadKg * 0.75) },
  ]
}

function rigidAxles(lengthCm: number, payloadKg: number): AxleGroup[] {
  const front = clamp(Math.round(lengthCm * 0.18), 40, lengthCm - 80)
  const rear = clamp(Math.round(lengthCm * 0.78), front + 50, lengthCm - 20)
  return [
    { name: "Front axle", positionFromFrontCm: front, maxKg: Math.round(payloadKg * 0.45) },
    { name: "Rear axle", positionFromFrontCm: rear, maxKg: Math.round(payloadKg * 0.8) },
  ]
}

function inferOogClass(mode: EquipmentMode, name: string): OogClass {
  if (mode !== "ROAD" && mode !== "SEA") return "NONE"
  const normalized = name.toLowerCase()
  if (
    normalized.includes("low boy") ||
    normalized.includes("lowboy") ||
    normalized.includes("double drop") ||
    normalized.includes("rgn")
  ) {
    return "LOWBOY"
  }
  if (normalized.includes("step deck") || normalized.includes("stepdeck")) return "STEPDECK"
  if (
    normalized.includes("flatbed") ||
    normalized.includes("flat rack") ||
    normalized.includes("platform") ||
    normalized.includes("open trailer") ||
    normalized.includes("roll trailer") ||
    normalized.includes("rolltrailer") ||
    /\bfr\b/.test(normalized) ||
    /\bpl\b/.test(normalized)
  ) {
    return "FLATBED"
  }
  if (normalized.includes("open top") || /\bot\b/.test(normalized)) return "OPEN_TOP"
  return "NONE"
}

function buildNotes(input: {
  input: EquipmentPhysicsInput
  innerHeightCm: number
  heightOpen: boolean
  floors: number
  axleGroups: AxleGroup[]
  oogClass: OogClass
  extendable: boolean
  maxExtendedLengthCm: number | null
}): string | null {
  const bits: string[] = []
  if (input.input.mode === "ROAD" && input.input.externalId === EU_BOX_TRAILER.externalId) {
    bits.push("Reference 13.6 m EU trailer: 24,000 kg payload, kingpin and rear tandem.")
  }
  if (input.heightOpen) {
    bits.push(`No internal height in the source sheet. Planning stack limit is ${input.innerHeightCm} cm.`)
  }
  if (input.floors > 1) {
    bits.push(
      `Modeled as ${input.floors} floors. The sheet height is the full internal opening, not one deck's clear height.`,
    )
  }
  if (input.extendable && input.maxExtendedLengthCm !== null) {
    bits.push(`Marked extendable. Planning maximum length is ${input.maxExtendedLengthCm} cm until edited.`)
  }
  if (input.oogClass !== "NONE") {
    bits.push(`Treated as ${input.oogClass} equipment for out-of-gauge cargo.`)
  }
  if (input.axleGroups.length > 0) {
    bits.push("Axle positions and limits are planning defaults. Limits apply to cargo weight, not tare.")
  }
  if (input.input.mode === "SEA" && input.axleGroups.length > 0) {
    bits.push("Kept on the Sea mode because that is the source sheet.")
  }
  return bits.length > 0 ? bits.join(" ") : null
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
