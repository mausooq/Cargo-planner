export const DIMENSION_COLORS = {
  length: "#d4a017",
  width: "#2563eb",
  height: "#6d28d9",
  volume: "#0f5c4c",
} as const

const lengthFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const weightFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const costFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

export function formatCm(value: number): string {
  return `${lengthFormat.format(value)} cm`
}

export function formatKg(value: number): string {
  return `${weightFormat.format(value)} kg`
}

export function formatCost(value: number): string {
  return costFormat.format(value)
}

export function formatEnvelope(lengthCm: number, widthCm: number, heightCm: number): string {
  return `${lengthFormat.format(lengthCm)} × ${lengthFormat.format(widthCm)} × ${lengthFormat.format(heightCm)} cm`
}

const volumeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
const percentFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatM3(value: number): string {
  return `${volumeFormat.format(value)} m³`
}

export function formatPct(value: number): string {
  return `${percentFormat.format(value)}%`
}

const CARGO_PALETTE = [
  "#e85d4c",
  "#2563eb",
  "#d4a017",
  "#0f766e",
  "#7c3aed",
  "#c2410c",
  "#0f5c4c",
  "#be123c",
  "#1d4ed8",
  "#65a30d",
  "#9333ea",
  "#0e7490",
] as const

export function cargoColor(name: string, fallback: string | null): string {
  if (fallback && /^#?[0-9a-f]{3,8}$/i.test(fallback)) {
    return fallback.startsWith("#") ? fallback : `#${fallback}`
  }
  const key = name.trim().toLowerCase() || "cargo"
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 33 + key.charCodeAt(i)) >>> 0
  return CARGO_PALETTE[hash % CARGO_PALETTE.length] as string
}

export function cargoLabelColor(hex: string): string {
  const raw = hex.replace("#", "")
  const value = raw.length === 3 ? raw.split("").map((part) => part + part).join("") : raw
  if (value.length < 6) return "#1a1d21"
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const luma = red * 0.299 + green * 0.587 + blue * 0.114
  return luma > 150 ? "#1a1d21" : "#ffffff"
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** "19 Oct 2026" from "2026-10-19". Fixed format so server and browser render the same text. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const [, year, month, day] = match
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}`
}
