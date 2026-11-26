/**
 * When a recalculation would throw away something the planner arranged, the planner is asked first.
 *  - "unsaved": cargo was moved in the Playground and the layout was not saved.
 *  - "manual":  the saved layout was arranged by hand. A new calculation packs the cargo again and replaces it.
 *  - null:      nothing of the planner's would be lost, so it simply runs.
 * Unsaved moves are named first because they are lost for good; a saved hand-arranged layout is the plan itself.
 */
export type RecalcGuard = "unsaved" | "manual" | null

export function recalculateGuard(input: { dirty: boolean; layoutSource: "AUTO" | "MANUAL" | undefined; hasPlan: boolean }): RecalcGuard {
  if (input.dirty) return "unsaved"
  if (input.hasPlan && input.layoutSource === "MANUAL") return "manual"
  return null
}
