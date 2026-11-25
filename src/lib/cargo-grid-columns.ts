/**
 * The cargo grid's columns and their widths, in one place.
 *
 * Every column has an explicit width. An earlier layout mixed percentages (which already added up
 * to 98%) with fixed widths and left the last data column on "auto": once the fixed columns had
 * taken their share nothing was left for it, so the Clearance column collapsed to no width and sat
 * under the sticky action column. With fixed widths for every column the table is exactly as wide as
 * its columns, `table-fixed` stretches them evenly when there is spare room, and the container
 * scrolls sideways when there is not.
 *
 * Widths are Tailwind classes written out in full so the class scanner finds them.
 */

export type GridColumnKey =
  | "select"
  | "sku"
  | "name"
  | "length"
  | "width"
  | "height"
  | "weight"
  | "quantity"
  | "noStack"
  | "turning"
  | "shape"
  | "floorOnly"
  | "priority"
  | "stop"
  | "consignment"
  | "clearance"
  | "actions"

export type GridColumn = {
  key: GridColumnKey
  /** Tailwind width class for the `<col>`. */
  width: string
  /** The same width in rem, for the table's minimum width. */
  rem: number
  /** Only shown with "More columns". */
  advanced?: boolean
}

export const GRID_COLUMNS: GridColumn[] = [
  { key: "select", width: "w-8", rem: 2 },
  { key: "sku", width: "w-28", rem: 7 },
  { key: "name", width: "w-56", rem: 14 },
  { key: "length", width: "w-24", rem: 6 },
  { key: "width", width: "w-24", rem: 6 },
  { key: "height", width: "w-24", rem: 6 },
  { key: "weight", width: "w-24", rem: 6 },
  { key: "quantity", width: "w-20", rem: 5 },
  { key: "noStack", width: "w-24", rem: 6 },
  { key: "turning", width: "w-40", rem: 10 },
  { key: "shape", width: "w-28", rem: 7 },
  { key: "floorOnly", width: "w-24", rem: 6, advanced: true },
  { key: "priority", width: "w-20", rem: 5, advanced: true },
  { key: "stop", width: "w-20", rem: 5, advanced: true },
  { key: "consignment", width: "w-40", rem: 10, advanced: true },
  { key: "clearance", width: "w-56", rem: 14, advanced: true },
  { key: "actions", width: "w-24", rem: 6 },
]

export function visibleColumns(showAdvanced: boolean): GridColumn[] {
  return GRID_COLUMNS.filter((column) => showAdvanced || !column.advanced)
}

/** The narrowest the table may be: the sum of its columns. Below this the container scrolls sideways. */
export function tableMinWidthRem(showAdvanced: boolean): number {
  return visibleColumns(showAdvanced).reduce((sum, column) => sum + column.rem, 0)
}

/** How many visible columns come after `key`: the width of the totals row's last cell. */
export function columnsAfter(showAdvanced: boolean, key: GridColumnKey): number {
  const columns = visibleColumns(showAdvanced)
  const index = columns.findIndex((column) => column.key === key)
  return index < 0 ? 0 : columns.length - index - 1
}
