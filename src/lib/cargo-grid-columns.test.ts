import { describe, expect, it } from "vitest"
import { columnsAfter, GRID_COLUMNS, tableMinWidthRem, visibleColumns } from "@/lib/cargo-grid-columns"

describe("cargo grid columns", () => {
  it("shows the extra columns, ending with Stop before the actions, only with More columns", () => {
    const basic = visibleColumns(false).map((column) => column.key)
    const more = visibleColumns(true).map((column) => column.key)
    expect(basic).not.toContain("stop")
    expect(more.slice(-2)).toEqual(["stop", "actions"])
    // The Consignment column was removed from the grid; the field itself is still kept on the line.
    expect(GRID_COLUMNS.map((column) => String(column.key))).not.toContain("consignment")
    // The handling-clearance column was removed with the feature and must not come back by accident.
    expect(GRID_COLUMNS.map((column) => String(column.key))).not.toContain("clearance")
  })

  it("gives every column an explicit width, so none can collapse to nothing", () => {
    for (const column of GRID_COLUMNS) {
      expect(column.width).toMatch(/^w-\d+$/)
      expect(column.rem).toBeGreaterThan(0)
    }
  })

  it("keeps the action column wide enough for the duplicate and delete buttons", () => {
    // Two 2rem icon buttons plus padding.
    expect(GRID_COLUMNS.find((column) => column.key === "actions")!.rem).toBeGreaterThanOrEqual(5)
  })

  it("makes the table exactly as wide as its visible columns, so the container scrolls instead of squeezing", () => {
    expect(tableMinWidthRem(false)).toBe(visibleColumns(false).reduce((sum, column) => sum + column.rem, 0))
    expect(tableMinWidthRem(true)).toBeGreaterThan(tableMinWidthRem(false))
    expect(tableMinWidthRem(true) - tableMinWidthRem(false)).toBe(GRID_COLUMNS.filter((column) => column.advanced).reduce((sum, column) => sum + column.rem, 0))
  })

  it("sizes the totals row to the columns that really exist", () => {
    expect(visibleColumns(false)).toHaveLength(12)
    expect(visibleColumns(true)).toHaveLength(15)
    expect(columnsAfter(false, "quantity")).toBe(4)
    expect(columnsAfter(true, "quantity")).toBe(7)
    expect(columnsAfter(true, "actions")).toBe(0)
  })
})
