export function normalizeUldName(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/\s+\)/g, ")").toLowerCase()
}

export function isAirPalletName(name: string): boolean {
  const normalized = name.toLowerCase()
  return ["pmc", "p6p", "pag", "paq", "p1p", "pla", "pra", "mdp", "pga", "pyb"].some((code) =>
    normalized.includes(code),
  )
}

export function isAirContourName(name: string): boolean {
  return (
    hasUldToken(name, "ld-1") ||
    hasUldToken(name, "ld-2") ||
    hasUldToken(name, "ld-3") ||
    hasUldToken(name, "ld3-45") ||
    hasUldToken(name, "ld-8") ||
    hasUldToken(name, "ld-26") ||
    hasUldToken(name, "a2n") ||
    hasUldToken(name, "aan")
  )
}

export function hasUldToken(name: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^0-9])`, "i").test(name)
}
