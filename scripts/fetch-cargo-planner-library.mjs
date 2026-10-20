import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const NAMES = {
  SEA: [
    "20ft DV",
    "40ft DV",
    "40ft HC",
    "45ft HC",
    "20ft RF",
    "40ft RF",
    "40ft RF HC",
    "20ft OT",
    "40ft OT",
    "20ft FR",
    "40ft FR",
    "40ft PL",
    "40ft OT HC",
    "20' Roll trailer - 25t",
    "40' Roll trailer -100t",
    "53' High Cube Rail Container",
    "62' Roll Trailer - 100t",
    "72' Roll Trailer - 80t",
    "Standard Chassis with 20ft DV",
    "Standard Chassis with 40ft HC",
  ],
  ROAD: [
    "Box Trailer (EU)",
    "Curtain trailer (EU)",
    "Megatrailer (EU)",
    "Open Trailer (EU)",
    "48ft Semi (US)",
    "53ft Semi (US)",
    "48ft Flatbed Trailer (US)",
    "53ft Flatbed Trailer (US)",
    "53ft Step Deck Trailer (US)",
    "Double Drop Trailer - Low Boy",
    "53ft High Cube Rail Container (US)",
    "Double Deck Trailer",
    "26ft Box Truck",
    "12m Semi Trailer (ZA)",
    "18m Super Link Trailer (ZA)",
    "Eastern Trailer",
    "Eastern Trailer (tall)",
    "Superlink 1st (ZA)",
    "Superlink 2nd (ZA)",
    "Truck",
    "VGK",
    "Trailer",
    "2ton Van Truck (CN)",
    "5ton Van Truck (CN)",
    "RGN (Extendable)",
  ],
  AIR: [
    "PMC/P6P - LD",
    "PMC/P6P - LD (Winged)",
    "PMC/P6P - Q6",
    "PMC/P6P - Q7",
    "PAG/P1P - LD-7",
    "PAG/P1P - Q6",
    "PAG/P1P - Q7",
    "LD-11 / ALP",
    "LD-1 / AKC",
    "LD-26 / AAF",
    "LD-2 (APA/DPA)",
    "LD3-45 / AKH",
    "LD-3 / AKE",
    "LD-8 / (ALN/DQN/DQF)",
    "LD-9 / AAP",
    "PGA 20ft",
    "PLA Half Pallet",
    "PLA Half Pallet (LD)",
    "PRA/MDP - 16ft Pallet",
    "PYB - Q6",
    "AAN",
    "CMP",
    "A2N",
  ],
  PALLET: ["Euro pallet", "GMA Standard Pallet", "Double-decker bolster for Rolltrailer", "Tripple-decker bolster for Rolltrailer"],
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[()]/g, "")
    .replace(/\//g, "-")
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function mmToCm(mm) {
  return Number((mm / 10).toFixed(2))
}

function firstNumber(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return Number(match[1].replace(/,/g, ""))
  }
  return null
}

function parsePage(html) {
  const inner = html.match(
    /(?:inner size|The size) of a[\s\S]{0,120}?is\s+([0-9.]+)\s*mm\s*x\s*([0-9.]+)(?:\s*mm)?\s*x\s*([0-9.]+)\s*mm/i,
  )
  const pallet = html.match(/size of a[\s\S]{0,80}?is\s+([0-9.]+)\s*mm\s*x\s*([0-9.]+)\s*mm/i)
  const maxHeight = firstNumber(html, [/maximum height of\s+([0-9.]+)\s*mm/i, /Max Height[\s\S]{0,80}?([0-9.]+)\s*mm/i])
  const door = html.match(/door that's\s+([0-9.]+)\s*mm\s*x\s*([0-9.]+)\s*mm/i)
  const bottom = /Bottom Contours/i.test(html)
  const top = /Top Contours/i.test(html)
  return {
    lengthMm: inner ? Number(inner[1]) : pallet ? Number(pallet[1]) : null,
    widthMm: inner ? Number(inner[2]) : pallet ? Number(pallet[2]) : null,
    heightMm: inner ? Number(inner[3]) : maxHeight,
    payloadKg: firstNumber(html, [/maximum payload of\s+([0-9.]+)\s*kg/i, /Payload[\s\S]{0,40}?([0-9][0-9,]*)\s*kg/i]),
    tareKg: firstNumber(html, [/tare of\s+([0-9.]+)\s*kg/i, /Tare[\s\S]{0,40}?([0-9][0-9,]*)\s*kg/i]),
    doorWidthMm: door ? Number(door[1]) : null,
    doorHeightMm: door ? Number(door[2]) : null,
    topLeftLengthMm: top ? firstNumber(html, [/Left Length[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
    topLeftHeightMm: top ? firstNumber(html, [/Left Height[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
    topRightLengthMm: top ? firstNumber(html, [/Right Length[\s\S]{0,80}?([0-9.]+)\s*mm/i]) : 0,
    topRightHeightMm: top ? firstNumber(html, [/Right Height[\s\S]{0,80}?([0-9.]+)\s*mm/i]) : 0,
    bottomRightLengthMm: bottom ? firstNumber(html, [/Right Length[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
    bottomRightHeightMm: bottom ? firstNumber(html, [/Right Height[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
    bottomLeftLengthMm: bottom ? firstNumber(html, [/Left Length[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
    bottomLeftHeightMm: bottom ? firstNumber(html, [/Left Height[\s\S]{0,40}?([0-9.]+)\s*mm/i]) : 0,
  }
}

function fetchHtml(url) {
  return execFileSync("curl", ["-sL", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", url], {
    encoding: "utf8",
    maxBuffer: 8_000_000,
  })
}

function fetchOne(name) {
  const slugs = [slugify(name)]
  for (const slug of slugs) {
    const url = `https://cargo-planner.com/equipment-library/${slug}/`
    try {
      const html = fetchHtml(url)
      if (html.includes("Page not found") || html.includes("404")) continue
      const parsed = parsePage(html)
      if (!parsed.lengthMm || !parsed.widthMm || !parsed.heightMm) continue
      return { name, slug, url, ...parsed }
    } catch {
      continue
    }
  }
  return { name, error: "not-found" }
}

const rows = []
for (const [mode, names] of Object.entries(NAMES)) {
  for (const name of names) {
    const row = fetchOne(name)
    rows.push({ mode, ...row })
    console.error(`${mode} ${name}: ${row.error ?? `${row.lengthMm}x${row.widthMm}x${row.heightMm} p=${row.payloadKg}`}`)
  }
}

const ok = rows.filter((row) => !row.error)
const payload = {
  fetchedAt: new Date().toISOString(),
  source: "https://cargo-planner.com/equipment-library/",
  count: ok.length,
  missing: rows.filter((row) => row.error).map((row) => row.name),
  items: ok.map((row) => ({
    mode: row.mode,
    name: row.name,
    innerLengthCm: mmToCm(row.lengthMm),
    innerWidthCm: mmToCm(row.widthMm),
    innerHeightCm: mmToCm(row.heightMm),
    maxPayloadKg: row.payloadKg,
    tareKg: row.tareKg ?? 0,
    doorWidthCm: row.doorWidthMm ? mmToCm(row.doorWidthMm) : null,
    doorHeightCm: row.doorHeightMm ? mmToCm(row.doorHeightMm) : null,
    contour: {
      topLeft: { lengthMm: row.topLeftLengthMm ?? 0, heightMm: row.topLeftHeightMm ?? 0 },
      topRight: { lengthMm: row.topRightLengthMm ?? 0, heightMm: row.topRightHeightMm ?? 0 },
      bottomLeft: { lengthMm: row.bottomLeftLengthMm ?? 0, heightMm: row.bottomLeftHeightMm ?? 0 },
      bottomRight: { lengthMm: row.bottomRightLengthMm ?? 0, heightMm: row.bottomRightHeightMm ?? 0 },
    },
  })),
}

writeFileSync(new URL("../src/lib/cargo-planner-library.json", import.meta.url), JSON.stringify(payload, null, 2))
console.error(`Wrote ${ok.length} items, missing ${payload.missing.length}`)
