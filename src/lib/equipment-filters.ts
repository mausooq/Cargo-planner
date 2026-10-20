import { EQUIPMENT_MODES, type EquipmentMode } from "@compass/domain"

export const LIBRARY_SORTS = ["name", "type", "length", "volume", "payload", "tare", "door"] as const
export type LibrarySort = (typeof LIBRARY_SORTS)[number]
export type SortDir = "asc" | "desc"
export type LibraryView = "list" | "table"

export type EquipmentFilters = {
  query: string
  mode: EquipmentMode | "ALL"
  openOnly: boolean
  oogOnly: boolean
  sort: LibrarySort
  dir: SortDir
  view: LibraryView
  lengthMin: number | null
  lengthMax: number | null
  payloadMin: number | null
  payloadMax: number | null
}

export function defaultEquipmentFilters(): EquipmentFilters {
  return {
    query: "",
    mode: "ALL",
    openOnly: false,
    oogOnly: false,
    sort: "name",
    dir: "asc",
    view: "list",
    lengthMin: null,
    lengthMax: null,
    payloadMin: null,
    payloadMax: null,
  }
}

export function defaultDir(sort: LibrarySort): SortDir {
  return sort === "name" || sort === "type" ? "asc" : "desc"
}

export function readEquipmentFilters(params: URLSearchParams): EquipmentFilters {
  const base = defaultEquipmentFilters()
  const mode = params.get("mode")
  const sort = params.get("sort")
  const dir = params.get("dir")
  const view = params.get("view")
  return {
    query: params.get("q") ?? "",
    mode: mode && isMode(mode) ? mode : "ALL",
    openOnly: params.get("open") === "1",
    oogOnly: params.get("oog") === "1",
    sort: sort && isSort(sort) ? sort : base.sort,
    dir: dir === "asc" || dir === "desc" ? dir : base.dir,
    view: view === "table" ? "table" : "list",
    lengthMin: readNumber(params.get("lmin")),
    lengthMax: readNumber(params.get("lmax")),
    payloadMin: readNumber(params.get("pmin")),
    payloadMax: readNumber(params.get("pmax")),
  }
}

export function writeEquipmentFilters(params: URLSearchParams, filters: EquipmentFilters) {
  setText(params, "q", filters.query.trim())
  setText(params, "mode", filters.mode === "ALL" ? "" : filters.mode)
  setText(params, "open", filters.openOnly ? "1" : "")
  setText(params, "oog", filters.oogOnly ? "1" : "")
  setText(params, "sort", filters.sort === "name" ? "" : filters.sort)
  setText(params, "dir", filters.dir === defaultDir(filters.sort) ? "" : filters.dir)
  setText(params, "view", filters.view === "list" ? "" : filters.view)
  setText(params, "lmin", filters.lengthMin == null ? "" : String(filters.lengthMin))
  setText(params, "lmax", filters.lengthMax == null ? "" : String(filters.lengthMax))
  setText(params, "pmin", filters.payloadMin == null ? "" : String(filters.payloadMin))
  setText(params, "pmax", filters.payloadMax == null ? "" : String(filters.payloadMax))
}

function setText(params: URLSearchParams, key: string, value: string) {
  if (!value) params.delete(key)
  else params.set(key, value)
}

function readNumber(value: string | null): number | null {
  if (!value || !value.trim()) return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

function isMode(value: string): value is EquipmentMode {
  return (EQUIPMENT_MODES as readonly string[]).includes(value)
}

function isSort(value: string): value is LibrarySort {
  return (LIBRARY_SORTS as readonly string[]).includes(value)
}
