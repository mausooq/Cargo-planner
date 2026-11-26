# DEV_PROGRESS.md — Phase 1: floor utilization + handling allowance

Checkpoint written at the end of the working session. Nothing is committed, pushed or merged.
Do not commit this file unless asked (it is untracked on purpose).

- Repo: `d:\cargoPlanner\Cargo-planner` (clone of `https://github.com/mausooq/Cargo-planner.git`)
- Working branch: `feature/floor-utilization-allowances` (created from `feature/my-improvements`, which equals `main` at 53ebf81)
- Helper scripts used for patching live OUTSIDE the repo in `d:\cargoPlanner\.tools\` (`rep.js`, `grid.js`, `hdr.js`, `stats.js`, `patch-plan.js`, `save-layout.txt`). They are not needed to resume. Safe to delete.
- Environment: Node v26, pnpm via `npx -y pnpm@10.34.6 ...` (pnpm is not installed globally). Source files use CRLF line endings in the working copy; Edit tool works on them, shell `sed`/node replace needs CRLF-aware code.
- No `.env`, no `dev.db`, no migration, no seed has been run. No production service was contacted.
- Project rule from `AGENTS.md`: this Next.js (16.3.8) has breaking changes; read `node_modules/next/dist/docs/` before writing new Next-specific code.

## 1. Original objectives and agreed requirements

### Phase 1 request (floor utilization and allowances)
Two separate floor metrics (team decision), not a single replaced figure:

1. **Actual floor utilization (%)**: exact union area of the cargo's own external footprints on the floor. Shared function, consistent units and floor-contact tolerance, no double counting of overlaps, stacked/elevated cargo excluded, existing footprint conventions kept (bounding rectangle for box/drum/pipe), **no 5 cm grid**.
2. **Effective floor utilization (%)**: floor needed once an optional handling/packaging allowance is added. Default 0 cm (identical to actual). Project-level default plus per-cargo override. Allowance = **per side** free space (operational spacing, not packaging already in entered dimensions). Shared gaps not double counted, overlapping reserved areas counted once, **never clipped to the unit** (violations must stay visible).
3. **Solver and Playground consistency**: allowances respected by the solver and by manual drag validation; collision, boundaries and clearance consistent; clearance never counted as stacking support; existing rotation/stacking/payload rules preserved; keep grid-based visualization/snapping; investigate the 5 cm grid dependencies before changing it.
4. **UI**: both metrics, labelled exactly "Actual floor utilization (%)" and "Effective floor utilization (%)", with tooltips, on Calculate (Workspace table), Load Plan, Playground, Excel and PDF/print report. Simple allowance configuration UI in Compass design system. Playground toggle to show the clearance envelope. With no allowance both metrics are identical.
5. **Saved metrics**: `savePlanLayout()` must recalculate and persist metrics, accept only valid layouts, keep old projects compatible, list remaining server-side validation limits separately.
6. **Tests**: zero/non-zero allowance, non-multiple-of-5 sizes, rotated, non-grid positions, overlapping envelopes, wall contact, fits physically but not with clearance, stacked and floor-only, boxes/drums/pipes, manual move and save, reload, consistency across screens/exports, backward compatibility, and the Jebel Ali 13.8% vs 15.8% sample if available.
7. **Restrictions**: separate feature branch (done), keep architecture/branding/four-step workflow, reuse components, do not rewrite the solver, no unrelated improvements, no new dependencies, do not weaken validation, no production connections, **ask before any DB schema change/migration**, no commit/push/merge without explicit approval.
8. **Final summary required** (not yet written): root cause, approach, files, before/after snippets, formulas, UI changes, DB changes, test results, limitations, manual localhost test steps.

### Additional requirement: automatic recalculation after manual rearrangement
After any move/rotate/remove/add back/rearrange recalculate live and server-side: actual and effective floor, volume, weight, remaining capacity, centre of gravity, longitudinal/lateral distribution, axle loads, loaded/unloaded counts, validation warnings. Live without pressing Recalculate; server independently validates and recalculates before saving; metrics persisted with positions; Calculate/Load Plan/Playground/PDF/Excel show the same saved numbers; reload never restores stale metrics; Undo and Reset update metrics; the packing algorithm is **not** re-run on manual layouts; axle modelling limits documented and not presented as safety compliance; regression tests required.

## 2. Key findings and decisions

- **Root cause of 13.8% vs 15.8% (confirmed):** Load Plan showed `unit.floorPct` from the solver (exact footprint sum, `z <= 1e-6`), the Playground used `liveMetrics()`/`floorCoverage()` in `src/lib/plan-metrics.ts`, a **5 cm grid that rounds each piece outward** (`floor`/`ceil`), `z > 0.5`. Reproduced the mechanism with 117x77 cm pieces (exact 9.56%, grid 9.82%). Second cause: `savePlanLayout()` never recalculated stored metrics, so Load Plan stayed stale after a save.
- **The original Jebel Ali shipment data is NOT in the repo** (only the string appears in a placeholder and a filename test). It could not be reproduced; the synthetic reproduction above stands in. Ask the user for the real cargo list/saved plan if a literal reproduction is wanted.
- **5 cm grid dependencies (investigated):** the 5 cm grid existed ONLY in `floorCoverage` (now removed). Snapping uses 8-40 cm / 5-12 cm reach (`cargo-snap.ts`), free-spot search uses a 10 cm candidate grid (`cargo-spot.ts`, kept, only extended with clearance-aware candidates). Viewer has no 5 cm grid.
- **No existing clearance support** existed in schema, solver or physics.
- **No schema change / migration was needed (decision, to be mentioned in the final summary):** project default allowance is stored in the existing `Project.rules` JSON as `{ clearanceCm }`; per-cargo override in the existing `CargoItem.customFields` JSON as `{ clearanceCm }` (next to `allowedRotations`); the allowance used for a plan is recorded in `Plan.settings.clearanceCm`; new metrics fields are written into the existing `EquipmentInstance.metrics` JSON. Missing values mean 0, so old projects behave as before. **Still NOT stored: loading `sequence`** (see pending/limitations; that would need a migration and approval).
- **Allowance semantics (implemented, documented in `packages/physics/src/footprint.ts` header and `src/lib/clearance.ts`):** `clearanceCm` = free space kept around a piece, per side. Wall: piece keeps its full allowance (envelope must stay inside the unit). Between two pieces: gap must be at least `max(a, b)` (shared, not the sum). Applies only between pieces that share height (`sharesHeight`); a piece resting on another needs no clearance and clearance never counts as support. Footprints for all shapes are the bounding rectangle `l x w` (existing solver convention). Floor contact tolerance `FLOOR_CONTACT_TOLERANCE_CM = 0.5`. Effective floor = union of footprints grown by their allowance, not clipped.

## 3. Work completed

### New files
| File | Purpose |
|---|---|
| `packages/physics/src/footprint.ts` | Shared pure geometry: `unionArea`, `floorUtilization` (actual+effective), `clearanceViolations`, `neighbourShortfallCm`, `boundaryShortfallCm`, tolerances. Exported from `@compass/physics`. |
| `packages/solver/src/unit-metrics.ts` | `computeUnitMetrics` (single source for all unit numbers incl. remaining kg/m3, both floors, CoG, axle estimate), `layoutWarnings`, `axleGroupsFromLoads`, `lateralLimitCm`, `HIGH_COG_PCT`. |
| `src/lib/clearance.ts` | Allowance helpers (`normaliseClearance`, `normaliseOverride`, `projectClearance`, `cargoClearance`), `MAX_CLEARANCE_CM = 100`, tooltip/help texts (`CLEARANCE_HELP`, `ACTUAL_FLOOR_HELP`, `EFFECTIVE_FLOOR_HELP`, `AXLE_ESTIMATE_NOTE`). |
| `src/lib/layout-validation.ts` | Server-side layout check using `validateDrop` + allowed-rotation check; `checkLayoutChange` only blames pieces that moved or were valid before (old invalid layouts stay savable if untouched). |
| `src/components/clearance-settings.tsx` | Project "Handling allowance" input (cm per side) + Save, shown in PlanWorkspace. |
| `src/components/clearance-envelope.tsx` | Translucent 3D frame showing each piece's allowance (display only). |
| `packages/physics/src/footprint.test.ts` | 21 tests. |
| `packages/physics/src/validate-clearance.test.ts` | 7 tests. |
| `packages/solver/src/clearance.test.ts` | 18 tests. |
| `DEV_PROGRESS.md` | This file. |

### Modified files
- `packages/physics/src/index.ts` (exports), `packages/physics/src/validate-drop.ts` (new reason `CLEARANCE`, `DropPiece.clearanceCm`, clearance check after collision and before support; skipped when no allowance).
- `packages/domain/src/index.ts` (`UNLOADED_REASONS` + `"CLEARANCE"`; `cargoItemInputSchema.clearanceCm` optional nullable 0..100).
- `packages/solver/src/types.ts` (`SolverCargo.clearanceCm`, `SolverSettings.clearanceCm`, `UnitMetrics` new fields `floorActualPct`, `floorEffectivePct`, `remainingKg`, `remainingM3`; `floorPct` kept = actual; reason `CLEARANCE`), `solve.ts` (default `clearanceCm: 0`, infeasible split aware of clearance, reason CLEARANCE), `unit.ts` (inset spaces, neighbour nudge `clearBox`, free spaces cut by the clearance envelope, `metrics()` delegates to `computeUnitMetrics`, exports `clearanceFor`, `insetSpace`, `fitsAnywhereEmpty`), `index.ts` (exports).
- `src/lib/plan-metrics.ts` rewritten: `liveMetrics(items, unit, setAside)` now calls the shared `computeUnitMetrics`; no 5 cm grid; adds both floors, remaining, axle estimate, set-aside count, clearance warnings.
- `src/lib/plan-view.ts` (new fields on `PlanItemView.clearanceCm`, `PlanUnitView` floors/remaining/tare, `PlanView.clearanceCm`, `SolverCargoHint.clearanceCm`, `withMetrics()`), `src/lib/plan-from-db.ts` (reads new metrics with fallback to old `floorPct`; item clearance = cargo override or the plan's saved default; now also passes `maxStackLoadKg` to items).
- `src/app/actions/plan.ts`: `savePlanLayout` rewritten (zod input check, full-unit completeness, physics validation, metrics + warnings recalculated server-side and persisted in one transaction, plan warnings refreshed, returns `{ units, planWarnings }`).
- `src/app/actions/projects.ts` (`updateProjectClearance`), `src/app/actions/cargo.ts` (`extrasJson` stores `clearanceCm` override).
- `src/app/(workspace)/projects/[id]/page.tsx` (passes project default + per-line override; plan marked stale when the allowance changed since calculation), `report/page.tsx` (both floor columns, definitions, axle estimate note, per-unit floor line).
- `src/lib/solver-input.ts`, `src/lib/equipment-suggest.ts`, `src/components/equipment-suggestions.tsx`, `equipment-setup.tsx`, `planner-app.tsx` (allowance threaded through to solver/suggestions).
- `src/components/plan-workspace.tsx` (ClearanceSettings, both floor metrics + remaining on Load Plan header and Workspace table, Playground stats incl. both floors/remaining/loaded-vs-set-aside/axle estimate, "Clearance" toggle, `onSaved` applies server-recalculated metrics/warnings, axle estimate note, stale banner wording), `cargo-grid.tsx` (advanced "Clearance (cm)" column + `OptionalCmCell`; `toCargoInput` keeps the field), `load-viewer.tsx` (`showClearance` prop).
- `src/lib/cargo-physics.ts` (`itemToPiece` passes clearance), `cargo-snap.ts` (flush snaps keep allowance), `cargo-spot.ts` (free-spot search tries allowance-offset candidates).
- `src/lib/plan-export.ts` (Excel: both floor columns, remaining payload/volume, new "Notes" sheet), `src/lib/plan-export.test.ts` (fixtures got the new required fields; the one assertion `"Floor used (%)"` was changed to the two new column names).

## 4. Current status

Implemented and compiling: shared geometry, solver clearance, drop-validation clearance, shared metrics, persistence, server-side validate+recalculate on save, project and per-cargo allowance UI, both metrics on Workspace table / Load Plan / Playground / Excel / print report, envelope toggle, snapping/free-spot adaptations.

Verified in this session (final run just before writing this file):
- `tsc --noEmit`: clean.
- `pnpm test`: **33 files, 229 tests, all passing** (baseline 184 + 45 new).
- `pnpm lint`: no output (clean).
- NOT verified: the app has not been started in a browser; no manual UI check; `savePlanLayout`, `updateProjectClearance` and the UI have no automated tests yet.

## 5. Pending tasks

1. **Tests still to write** (from the requirements):
   - `src/lib/plan-metrics` tests: no-grid regression (pieces that are not 5 cm multiples; the 117x77 reproduction; live == solver numbers for the same layout; zero allowance => actual == effective; live set-aside count; remaining kg/m3; undo/reset reproduce the same metrics because they derive from `items` (pure function test)). The existing `plan-metrics.test.ts` (5 tests) still passes unchanged.
   - `src/lib/layout-validation.test.ts`: valid layout; clearance violation rejected; floating piece; illegal rotation; piece against wall; old invalid layout tolerated unless the piece moved.
   - `src/app/actions/plan.test.ts` (mock prisma and session like `src/app/actions/equipment.test.ts`): `savePlanLayout` persists recalculated metrics + warnings, rejects invalid layout (no transaction), rejects incomplete unit, viewer role refused; reload via `planFromDb` returns the saved metrics; old plan (no `floorActualPct`, no settings) loads with effective == actual; `updateProjectClearance` validation.
   - `plan-from-db` backward-compat test; `plan-export` test for the new columns/notes rows; `cargo-snap`/`cargo-spot` tests with allowance and unchanged behaviour at 0; `solver-input` test (allowance and per-line override passed); `clearance.ts` unit tests.
   - Consistency test across Workspace/Load Plan/Playground/Excel rows built from one saved layout.
2. **Manual QA on localhost** (never done): see section 8.
3. **Docs:** add a "Handling allowance and floor utilization" section and the axle-model limitations to `docs/ASSUMPTIONS.md` (the code comments already refer to it). Update README only if wanted.
4. **Review the savePlanLayout UX:** if the server rejects, the Playground keeps the edit and shows the message (toast). Check that wording is good.
5. **Final implementation summary** (items 1-10 of the original request) including before/after snippets and formulas (draft below).

## 6. Outstanding issues, risks and incomplete code

No known compile, lint or test failures. Things to check or decide:
- **Unverified at runtime:** the whole UI path, `savePlanLayout` against a real SQLite DB, and the 3D envelope. Treat as untested until manual QA.
- **Server validation vs Playground settings:** the server uses default physics settings (70% min support, strict rules, payload NOT blocked). A user who lowered "min support" in Playground settings can be refused on save. Intended trade-off; confirm with the user.
- **Remaining server-side validation limitations (to report separately):** payload and axle limits are warnings, not refusals; loading order/destination order not validated; no check that cargo identity/quantities match (only ids present on the plan); contour (ULD cut) shapes are not enforced on manual edits (same as the Playground); concurrent edits are not detected (last save wins; ids must exist); a new plan from `persistPlan` is still trusted from the client (not re-validated).
- **Pre-existing, not fixed (out of scope):** the loading `sequence` is not stored in the DB (`plan-from-db.ts` sets `sequence = row index + 1` and the query has no `orderBy`), so the order after reload is not guaranteed to be the solver's; axle model ignores tare and splits rear axles equally; `Project.solverSettings` unused; 3+ axle groups simplistic. Persisting `sequence` needs a Prisma migration, which requires user approval.
- **Solver limitation:** with clearance the greedy nudge (`clearBox`) slides past a conflicting neighbour along x then y only; very tight mixed-allowance layouts may leave more cargo unloaded than an optimal packer would. Behaviour at allowance 0 is unchanged (test proves identical output).
- Clearance is applied horizontally only (not to the roof or between vertically separated pieces). Drums/pipes use the bounding square for clearance, like the solver; the Playground still collides drums as circles when the allowance is 0.
- `plan-export.test.ts` was edited (fixtures + the renamed column assertion). All other 184 baseline tests are untouched and pass.
- Files use CRLF in the working copy; git warns about LF→CRLF. Harmless.
- Excel/print report show `floorEffectivePct` from stored metrics; plans saved before this feature fall back to actual.
- Per-cargo override is not part of Excel/CSV cargo import/export or AI extraction (not requested).

## 7. Formulas (for the final summary)

- Footprint of a piece: placed bounding rectangle `l x w` (cm). On floor if `z <= 0.5`.
- `actualArea = area( union of [x, x+l] x [y, y+w] ) for floor pieces`; `actual% = actualArea / (unitLength x unitWidth) x 100`.
- `a_i` = piece allowance (cargo override, else project default, else 0), per side.
- `effectiveArea = area( union of [x-a_i, x+l+a_i] x [y-a_i, y+w+a_i] )`, not clipped; `effective% = effectiveArea / (L x W) x 100`.
- Valid layout (when any allowance > 0): envelope inside the unit (`x-a >= 0`, `x+l+a <= L`, same for y); for two pieces that share height, `gap >= max(a_i, a_j)` where `gap = max(dx, dy)` (negative if overlapping).
- Remaining: `payload - net kg`; `unit volume - sum(l x w x h)`.

## 8. Exact next steps to resume tomorrow

1. `cd d:\cargoPlanner\Cargo-planner`, confirm `git branch --show-current` = `feature/floor-utilization-allowances`, `git status` shows the files listed above (nothing committed).
2. Re-verify the baseline: `npx -y pnpm@10.34.6 exec tsc --noEmit`, `npx -y pnpm@10.34.6 test` (expect 33 files / 229 tests), `npx -y pnpm@10.34.6 lint`.
3. Write the pending tests from section 5.1 (start with `src/lib/layout-validation.test.ts` and `src/app/actions/plan.test.ts`, then the plan-metrics no-grid and consistency tests). Fix any bug they expose in `layout-validation.ts` / `plan.ts`.
4. Add the `docs/ASSUMPTIONS.md` section (allowance semantics, formulas, axle estimate disclaimer, validation limits).
5. Ask the user before running anything that touches the database: to try the app locally they need `cp .env.example .env` (set `AUTH_SECRET`), `pnpm prisma migrate dev`, `pnpm db:seed`, `pnpm dev` (local SQLite only). **Get explicit approval first**; no schema changes are required by this work.
6. Manual QA at http://localhost:3000 (demo login `planner@compass.local` / `compass-demo`): create a project, add cargo with sizes that are not multiples of 5 cm (e.g. 117x77x90), calculate with allowance 0 and check Workspace table, Load Plan header, Playground stats and Excel all show identical actual = effective; set the project allowance to e.g. 5 cm, Recalculate, check effective > actual and the Clearance toggle in the Playground; drag a piece too close to another (should be refused with a clearance message); set a per-line override in Data > Advanced > "Clearance (cm)"; move pieces, Save layout, reload the page and confirm the numbers persisted; Undo/Reset layout and set-aside/add back update the live numbers; open Print / PDF and Excel and check both columns and notes.
7. Fix anything found, re-run the three checks, then write the final implementation summary (section 8 of the original request). Do not commit, push or merge until the user explicitly approves.

## 9. Final-summary notes (draft)

- Root cause: two different floor formulas (exact in the solver vs a 5 cm outward-rounding grid in the Playground) plus stored metrics never refreshed after a layout save.
- Approach: one shared geometry module (`footprint.ts`) and one shared metrics function (`computeUnitMetrics`) used by solver, Playground, server save, reports; allowance as explicit per-side clearance enforced in solver and physics; server validates with the same physics before recalculating and persisting.
- DB changes: none (JSON columns only); sequence persistence deferred pending approval.


---

## Update 2026-11-25 (tests and docs completed)

Done since the checkpoint above:
- New tests: `src/lib/layout-validation.test.ts` (16), `src/app/actions/plan.test.ts` (15, mocked prisma/session), `src/lib/plan-from-db.test.ts` (8), `src/lib/clearance.test.ts` (4), `src/lib/floor-consistency.test.ts` (20: no-grid regression, one layout across Calculate/Load plan/Playground/Excel/reload, live metrics with undo/reset/set-aside), `src/lib/clearance-integration.test.ts` (15: snapping, free spot, solver input, export rows and notes, `updateProjectClearance`).
- Bug found by the new tests and fixed: `layoutProblems` in `src/lib/layout-validation.ts` validated each piece against ALL others, so `validateDrop` settled a lower piece onto the piece stacked above it and every stacked layout was refused. It now checks each piece only against pieces at or below its own level.
- `docs/ASSUMPTIONS.md`: new section "Floor utilization and handling allowance" (methodology, formulas, allowance definition, storage, recalculation, known limitations incl. axle estimate).
- Verification: `tsc --noEmit` clean; `pnpm test` 39 files / 307 tests passing; `pnpm lint` clean.
- Local configuration inspected read-only: `.env` and `prisma/dev.db` exist and are gitignored; `prisma migrate status` = "Database schema is up to date!" (6 migrations). No migration is required by this work. Nothing was reset, deleted, reseeded, committed, pushed or merged.

Still open: manual QA in the browser (checklist given in the chat summary), `next build` not run (it would overwrite `.next` used by a running dev server), final review by the user.


---

## Update 2026-11-25 (later): Phase 1 enhancements, directional clearance and Save & Recalculate

Manual QA of the first Phase 1 build passed. This round implements the enhancement request (sections 1 to 10 of that request). Nothing is committed, pushed or merged. Branch: `feature/floor-utilization-allowances`. No schema change, no migration, `.env` and `prisma/dev.db` untouched. A dev server is running on port 3000 (PID 19856) and was NOT stopped.

### Status

Implemented and covered by automated tests; **not yet exercised in a browser** (new UI: clearance editor, cargo grid cell, Manage clearances, Playground sidebar/legend/violation highlight, Save & Recalculate banners). **Production build not run** because the dev server is running (see next steps).

Checks at the end of this round: `tsc --noEmit` clean; `pnpm lint` clean; `pnpm test` 47 files / 455 tests passing (307 baseline + 148 new).

### What was built

- **Per-side clearance model** (`packages/physics/src/clearance-model.ts`, `footprint.ts`): `ClearanceSetting` = `null` (inherit) | number (uniform, `0` explicit none) | `{front, rear, left, right}` (directional). Placed sides `Clearance4 {x0,x1,y0,y1}`. Rotation codes `LWH`, `WLH`, `LWH@180`, `WLH@180` (flat facings; quarter turns clockwise from above), tipped codes use the largest value on every side. Neighbour rule: neither piece's physical box inside the other's reserved space (facing sides share the gap = larger of the two). Boundary per side. Effective floor = union of per-side envelopes, unclipped.
- **Solver** (`packages/solver/src/unit.ts`, `solve.ts`, `types.ts`): `ownSidesFor`, `placementOptions` (adds `@180` facings only for directional, non-`FIXED` lines), per-side inset/envelope, `clearBox` nudge using facing sides, `CLEARANCE` unloaded reason message, `SolverCargo.clearanceSides`.
- **Storage (no migration)**: line setting in `CargoItem.customFields` (`clearanceCm` or `clearanceSides`), project default `Project.rules.clearanceCm`, project minimum support `Project.rules.minSupportPct` (50..100), plan record in `Plan.settings` (`clearanceCm`, `clearanceConfig`, `layoutSource` AUTO/MANUAL, `syncedAt`). Helpers in `src/lib/clearance.ts`.
- **Server** (`src/app/actions/plan.ts`, new `clearance.ts`): `saveClearanceConfig` (default + many lines, one transaction, returns stored config); `savePlanLayout(projectId, rows, {minSupportPct, clearanceChanges})` validates all units that hold a changed line, persists metrics/warnings/config atomically, sets `layoutSource` MANUAL when cargo moved; `revalidatePlanLayout(projectId, {defaultCm, clearanceChanges})` = "keep current layout" (no repack, nothing saved if invalid); `persistPlan` records the config the packer used; rotation code is checked against the sizes and the cargo line's orientation rule; one support share (`src/lib/layout-validation.ts`).
- **Stale detection** (`page.tsx` `isPlanStale`): cargo edited after max(plan.createdAt, syncedAt) or configuration differs from the recorded one; `describeConfigChange` explains the difference in the banner.
- **Flow logic** (`src/lib/clearance-flow.ts`): pure, tested: one solver run per apply, latest saved config, single-flight lock, failure keeps previous plan + retry, manual-layout confirmation (Cancel / Keep current layout / Save & Recalculate).
- **UI**: `clearance-editor.tsx` (one reusable dialog, three modes, top-view diagram, "Restore project default", quantity note), cargo grid "Clearance" cell (wider column, sticky action column), `manage-clearances.tsx` (project default + searchable/paged line list, batch Save & Recalculate, counts), `clearance-settings.tsx` (Save & Recalculate + Manage button + status line + "plan used X" note), `plan-workspace.tsx` (flow wiring, banners, failure/keep messages, Playground sidebar clearance info + Edit clearance, pending line edits with Undo/Reset, violation highlight, legend, project allowance stat, concise "Actual floor"/"Effective floor" labels), `clearance-envelope.tsx` (asymmetric, red when broken, shown for the selected piece even with the toggle off), `load-viewer.tsx` (`violationIds`), snapping/free-spot/rotation (`cargo-snap.ts`, `cargo-spot.ts`, `cargo-skin.ts`), exports (Clearance column in packing list and report).
- **Docs**: `docs/ASSUMPTIONS.md` updated (modes, rotation table, tipped rule, shared gaps, configuration/staleness, Save & Recalculate, manual layouts, one support share, limitations).

### Decisions to confirm with the user

1. Tipped pieces: the largest of the four values applies on every side (conservative, nothing dropped).
2. Facing is stored in the existing rotation text (`LWH@180`, `WLH@180`), no schema change.
3. The project minimum support share is stored in `Project.rules` and written only when it differs from the value in force (so a plain layout save never changes packer behaviour).

### Remaining / next steps

1. Stop the dev server only if the user agrees, then `pnpm build` (production build) and report; or user confirms they stopped it.
2. Manual QA in the browser (checklist in the chat summary): grid cell + editor, Manage clearances, Save & Recalculate (with and without a plan, with a manual layout, failure/retry is hard to trigger by hand), Playground edit/violations/legend, reload, exports.
3. Review `git diff`; do not commit until approved.


---

## Update 2026-11-25 (final refinements and QA corrections)

Manual QA passed for floor figures, project allowance, per-line clearance, Manage clearances, Save & Recalculate, the manual-layout dialog, keeping a valid layout and rejecting an invalid one. This round fixes the items found. **Nothing is committed, pushed or merged.** Branch `feature/floor-utilization-allowances`. No schema change, no migration; `.env` and `prisma/dev.db` untouched and gitignored. The dev server (port 3000, PID 11860) was left running; the production build has NOT been run.

Checks at the end of this round: `tsc --noEmit` clean; `pnpm lint` clean; `pnpm test` **51 files / 533 tests passing** (455 at the start of the round).

### Corrections

1. **Missing Clearance column (root cause):** the `<colgroup>` mixed percentage widths (the existing ones already summed to 98%) with fixed `rem` widths, and the last data column was left on `<col />` (auto). After the fixed columns took their share nothing was left, so the Clearance column collapsed to zero width and sat under the sticky action column. Every column now has an explicit width from `src/lib/cargo-grid-columns.ts`; the table minimum width is the sum of its columns (it scrolls sideways instead of squeezing); the totals row's last cell is `columnsAfter(...)` (it was one column short); the action column has a separator. Tested in `cargo-grid-columns.test.ts`.
2. **Keep current layout for every calculated plan:** one "Apply clearance changes" dialog (Cancel / Keep current layout / Save & Recalculate, with an extra warning for hand-arranged plans) is used by the project allowance control and by Manage clearances on both pages. No plan: just save. `clearance-flow.ts` asks for any plan; `plan-workspace.tsx` `requestApply`.
3. **One plan status:** `src/lib/plan-status.ts` (not-calculated / calculating / ready / out-of-date / failed) is reported by the Calculate page to the stepper (`onStatusChange`); staleness is decided only by `src/lib/plan-staleness.ts` (page, dashboard, actions). Root cause of the contradiction: the stepper used the server's `planStale` prop while the page kept its own local flag; the dashboard used a third rule (cargo edit time only). A rejected change no longer marks a plan out of date. A cargo signature (`Plan.settings.cargoSignature`) keeps clearance edits and cargo edits apart, so "keep layout" can never hide an unrelated cargo edit.
4. **Fix in Playground:** a rejected proposal stays as a draft (never saved). The message says it was not saved, shows what was proposed and which pieces (with their unit) break it, and offers Fix in Playground / Save & Recalculate instead / Discard. The Playground opens on the first affected unit with the draft applied (broken pieces red, "Unsaved clearance changes" strip, Reset layout discards, saving saves the draft with the layout; a proposed project default is carried too). `onOpenPlan` prop added to `PlanWorkspace`.
5. **One support share:** `packages/physics/src/support-policy.ts` (`DEFAULT_MIN_SUPPORT_PCT = 75`, range 50..100, `resolveMinSupportPct`). Used by the packer, `validateDrop`, the Playground (editor store, keyboard moves, rotation, add back, free-spot search: `cargo-skin.ts` had a hard-coded 0.7), `layout-validation.ts` and `savePlanLayout`. The Playground starts from the project value every time; the server validates and stores a client value only within range; the default is never written to the project.
6. **Rotation compatibility:** verified and tested (four quarter turns, fixed/longship rules, legacy codes, new codes persisted/restored, tipped rule, zero-clearance neighbour, packer layouts accepted by the server validator). Fixed: a fixed-orientation line could be turned in the Playground (the server refused it at save); now refused in the Playground and, for any code other than `LWH`, by the server. Excel packing list got a `Facing` column in words.
7. **UI review:** button "Apply changes…" when a plan exists (it opens the dialog), "Save" otherwise; concise "Actual floor"/"Effective floor" labels in compact views; viewers can read but not apply in Manage clearances.
8. **Code review of the diff, fixes made:**
   - `reviewLayout` (the shared core of `savePlanLayout` / `revalidatePlanLayout`) did not validate units that were not sent when the configuration had changed elsewhere, yet recorded the plan as checked under it. It now checks every unit whenever the configuration differs from the recorded one, and "before" is built from the recorded configuration (lines it did not list were inheriting).
   - removed unused helpers (`requiredGapCm`, `planGapCm`), one shared `recordOf` (`src/lib/json.ts`), the 100 cm limit taken from `MAX_CLEARANCE_CM` (a test keeps the domain schema in step).

### Files added in this round
`src/lib/cargo-grid-columns.ts(+test)`, `src/lib/plan-staleness.ts(+test)`, `src/lib/plan-status.ts`, `src/lib/json.ts`, `packages/physics/src/support-policy.ts`, `src/lib/support-policy.test.ts`, `src/lib/rotation-compat.test.ts`. Modified in this round include `cargo-grid.tsx`, `plan-workspace.tsx`, `planner-app.tsx`, `manage-clearances.tsx`, `clearance-settings.tsx`, `clearance-flow.ts(+test)`, `plan.ts` (actions), `projects`/dashboard/project pages, `project-status.ts`, `layout-validation.ts`, `cargo-skin.ts`, `cargo-spot.ts`, `solver-input.ts`, `plan-export.ts`, `plan-view.ts`, physics/solver defaults, `docs/ASSUMPTIONS.md`.

### Test changes to existing tests (all explained)
`support.test.ts` states its 70% threshold explicitly (it tests geometry at exactly 70%, not the default); `clearance-flow.test.ts` reflects "ask for any plan"; two assertions in `clearance-directional-ui.test.ts` / `plan-clearance.test.ts` reflect the 75% default.

### Remaining limitations
Axle model (cargo weight only, simple beam, rear groups equal), loading sequence not persisted (needs a migration and approval), greedy packer on tight mixed loads, a freshly calculated plan is stored as the browser sent it, support share is a planning constraint not a stability guarantee, tipped pieces use the largest clearance on every side. The new screens were verified by automated logic tests and manual testing, not browser automation.

### Next steps
1. User manual QA of the corrected items (checklist in the chat summary).
2. When the user confirms the dev server is stopped (or asks me to stop it): `pnpm build`, report.
3. On approval only: review `git diff`, create the Phase 1 commit. Do not push.


---

## Update 2026-11-25 (multi-unit dimension entry)

Feet added to the Sizes in list (mm, cm, m, in, ft), with decimal feet and feet-and-inches input. Nothing committed. No schema change, no migration, `.env` and `prisma/dev.db` untouched. Dev server not touched; production build not run.

Checks: `tsc --noEmit` clean; lint clean; `pnpm test` 52 files / 575 tests passing (533 before).

### What was there
Two separate unit tables: the grid's (`cargo-units.ts`: cm, in, m, own factors, `type=number` inputs) and the importer's (`cargo-import.ts`: cm, mm, in, m, its own `toCentimetres`). Storage and solver were always centimetres. The display preference lived inside `cargo-grid.tsx` (localStorage `compass.cargo.lengthUnit`), so other screens always showed cm.

### What changed
- `src/lib/cargo-units.ts`: single source (`CM_PER_UNIT`), five units, `parseLength` (plain, decimal, written unit, feet-and-inches), `interpretLengthEdit` (blank / same / changed / invalid), `roundStoredCm`, display helpers. The importer now reuses it (`toCentimetres` is a thin wrapper, `LENGTH_UNITS` re-exported).
- `src/lib/length-unit-pref.ts`: shared `useLengthUnit()` (same storage key, so existing choices carry over).
- Cargo grid: size boxes are text inputs (feet and inches need letters), `L (ft)` style titles, a hint `= 5 ft 6 in` in feet, an unreadable entry is not applied and the box is restored with a message; switching units never writes.
- Import: size cells accept feet, feet-and-inches and written units; unit suggested only from size column titles (`readDimensionHeader`, `suggestLengthUnit`); wizard says where the unit came from.
- Export: `cargoExportHeaders/Rows(unit)`; Excel plan export `summaryRows/packingRows/noteRows(unit)` with the unit in titles and a Units note; report page states its units.
- Display in the chosen unit: equipment catalogue/compare/setup (`formatCm/formatEnvelope(…, unit)`), Calculate and Load plan tables, Playground piece details, clearance editor and Manage clearances (clearance stays cm, stated), 3D dimension labels (`DimensionMarks unit`).
- `docs/ASSUMPTIONS.md` "Cargo units" rewritten.

### Tests
`length-units-feet.test.ts` (42): all unit pairs, decimal feet vs feet-and-inches, invalid input, 60 cycles of unit switching with no rewrite, editing in feet, cargo entered in five units packs identically (volume, floor figures, clearance), plan status/signature independent of the unit, import (titles, mixed units, errors, old mappings), export/import round trip per unit, Excel packing list in feet. One existing test (`clearance-integration`) now expects the extra `Units` note.

### Limitations
Equipment fit-filter boxes in the catalogue and the clearance inputs stay in centimetres (labelled). The printed/PDF report is server-rendered and stays in centimetres. Feet-and-inches is for the grid and for imported cells; the importer's header detection only recognises length/width/height columns. Decimal commas: `1,5` is 1.5 (a single comma not followed by three digits); `1,200` in an imported cell is 1200.

## Integration of origin/main (684ce0c) — local only

- Checkpoint commit `225c10d` (all Phase 1, clearance and multi-unit work; DEV_PROGRESS.md excluded). Local backup branch `backup/pre-merge-main` points at it. Neither is pushed.
- `git merge origin/main` brought in the teammate's step-4 piece table (SKU, entered values, Turned tag). One conflicted file: `src/components/plan-workspace.tsx` (5 conflict regions, plus a duplicated `cargo` prop on `LoadPlanDetail` and on its call site).
- Resolution: the teammate's data source and columns, our unit handling. Headings use `lengthTitle(letter, unit)`; sizes use `formatEnteredLength(cm, unit)`; weight stays kg ("kg / piece"); the Turned tooltip (`turnedTitle`) is written in the selected unit; Playground lists keep `formatEnvelope(..., unit)`.
- `src/lib/plan-piece-values.ts`: sizes are read back from the saved piece through its rotation code (`parseRotation` axes), so the saved plan is always what is shown. The cargo line supplies the exact typed numbers, name and mark only when the plan is current and the line agrees with the piece. `turned` is true for any rotation other than as entered, including `LWH@180` (same sizes, other facing) and tipped codes; `facing` carries the words ("Turned 90°", "Turned 180°", ...).
- Out-of-date plans: new `planCurrent` prop (`!stale`). A stale plan, or a line edited after calculation, never replaces the saved sizes, name, mark or weight. The existing out-of-date warning is unchanged.
- Limitation: for a stale plan the table does not say which values changed in step 1 since the calculation; the plan-level warning is the only signal. Also a piece's entered order is derived from its rotation code, so a code the app cannot read is shown as placed.
- Tests: 595 pass (575 baseline + teammate's + 20 new in `plan-piece-values.test.ts`); typecheck and lint clean. The teammate's exact-shape `toEqual` became `toMatchObject` because the result gained `facing` and `source`.

## Intelligent packing-list import (local, uncommitted, on top of merge 9ac71dc)

Baseline before this work: 595 tests. Now: see the final run below.

- One import dialog (Upload file / Paste image / Paste text) -> optional spreadsheet mapping step -> one review screen (original left, editable lines right). Nothing saved until the planner imports; append or confirmed replace (one transaction).
- Spreadsheets stay deterministic and need no API key: header detection after title blocks, several sheets/tables, merged cells, combined sizes (120 x 80 x 60 cm), total/subtotal rows left out, line-total weights (confirmed before dividing). Optional "read this sheet with AI" fallback.
- AI reading (Claude, unchanged integration) for PDF, images, pasted text; provider-independent contract in `src/lib/extraction-provider.ts`; model/provider/timeout/page limit from env. Values are returned as written and converted by the shared unit code. Never assumes units; flags missing/ambiguous/invalid; source refs only when reported.
- New: `import-units.ts`, `import-review.ts`, `import-table.ts`, `import-sheet.ts`, `import-upload.ts`, `extraction-provider.ts`, `cargo-import-review.tsx`; rewritten: `cargo-extract.ts`, `cargo-extract-server.ts`, `cargo-import-wizard.tsx`, `actions/cargo.ts` (readSpreadsheetFile, extractCargoFromDocument/Text/Sheet, getImportCapabilities, importReviewedCargo); removed `cargo-file.ts`; `buildImportPreview` moved to `import-table.ts` (same behaviour, existing tests pass unchanged apart from the import path).
- `importCargoRows` is unchanged on purpose (the grid's Undo-delete restores lines, possibly incomplete, through it).
- No schema change, no migration, `.env` and the database untouched. `.env.example` documents the AI variables (commented).
- Not done / needs approval: page batching of long PDFs (needs a PDF library), replacing the `xlsx` dependency, live Claude testing with a key, multilingual accuracy measurement, component (browser) tests for the dialog.

## Selective removal of the handling-clearance feature (local, uncommitted)

Checkpoints: `83b0623` (packing-list import, on top of merge `9ac71dc`) and local backup branch `backup/with-clearance-feature` pointing at it. The backup holds the complete clearance feature, the teammate's merged work and the import. Nothing pushed.

Removed: project allowance, per-line and directional clearance, the Cargo grid Clearance column and editor, Manage clearances, Apply-changes / Keep current layout / Fix in Playground flows, clearance drafts, the 3D envelope + toggle + legend, effective floor utilization, clearance in the packer / physics / snapping / free-spot search / layout validation / Excel + report / import review + AI schema, `updateProjectClearance`, `saveClearanceConfig`, `revalidatePlanLayout`, the `CLEARANCE` unloaded reason, and the clearance options of `persistPlan` / `savePlanLayout`.

Kept: exact union floor utilization (renamed "Floor utilization", one figure, recomputed from saved positions on every load), live + server metrics, server layout validation, shared 75% support share, plan status + cargo-only staleness (signature function untouched, so every saved signature still matches), multi-unit entry/display, the teammate's entered-values table with SKU and Turned tag, import, provider architecture, AUTO/MANUAL flag (+ new confirmation before recalculating over a hand-arranged layout, `recalc-guard.ts`).

Shared code reorganised, not restored from the old branch: `physics/rotation.ts` (legacy `@180` codes still read; `nextFlatRotation` for the Playground), `physics/footprint.ts` (floor only), `lib/support-policy.ts`, `lib/plan-notes.ts`.

Backward compatibility: retired keys (`Project.rules.clearanceCm`, `customFields.clearanceCm/clearanceSides`, `Plan.settings.clearanceCm/clearanceConfig`, metrics `floorActualPct/floorEffectivePct`) are ignored and left in place; other JSON keys are preserved on save (`extrasJson`, `savePlanLayout`). No migration, no cleanup, no schema change. `.env` and `prisma/dev.db` not touched by this work.

Solver safety: `packages/solver/src/packing-equivalence.test.ts` pins 9 zero-clearance jobs (units, packed, unloaded, floor %, fingerprint of every placement) recorded BEFORE the solver was edited. All identical after.

Tests: 717 -> 557 (see the report for the breakdown). tsc and lint clean.

## Compact import review + gross/net extraction (local, uncommitted, on top of the clearance removal)

- Review is now an inline compact table under the Cargo grid (not a split modal): inline editing, one collapsible "Please check" box (required / confirm / info), optional "View original" dialog, one summary line, "Add lines and suggest equipment" / "Add lines only", append/replace with confirmation.
- Extraction: gross, net and unlabelled weights are separate fields; `weightScope` (+ evidence); `tableSizeUnit`. A joined "2210 net / 2360 gross" is repaired (`splitNetGross`). Planning weight = gross; net kept as reference. Quantity 1 needs no weight interpretation; qty > 1 unclear -> kept as read and asked; explicit line total -> divided, informational.
- Sizes with no unit keep their numbers; one unit choice covers every such row; original values kept in `ReviewLine.original`.
- Drafts: "Add lines only" can add incomplete lines (zeros + `customFields.importNotes`, no schema change). Calculate now leaves incomplete lines out of the solver (`plannableLines`).
- New: `import-edit.ts` (pure editing rules), `import-compact-review.test.ts`, `import-units-netgross.test.ts`, `cargo-plannable.test.ts`; changed: `import-review.ts`, `cargo-extract.ts`, `import-table.ts`, `cargo-import-review.tsx`, `cargo-import-wizard.tsx`, `actions/cargo.ts`, `cargo-grid.tsx`, `plan-workspace.tsx`, `planner-app.tsx`.
- Lesson: shell heredocs collapse `\` and turn `\b` into a backspace character; patches with regexes are written with the file tool instead.

## Packing-list extraction and review improvements (uncommitted)

- Mark ranges expand to one line per package (qty 1); package quantity vs `contentsQuantity`; package type + commodity names; document unit kept as the review's default display unit.
- Equal-share weight estimates from the document's total gross (`suggestWeightDistribution`, exact to 0.01 kg), shown as `est.`, confirmed in review, grid (`confirmEstimatedWeights`) or by the Calculate dialog (`linesNeedingWeightConfirmation`). Equipment suggestions marked Provisional.
- Not-stated stacking -> stackable=false + `customFields.stacking = "not-stated"`; cleared when the planner changes stacking.
- Document totals: packages, product quantity, net, gross, volume.
- Tests: `src/lib/import-extraction-quality.test.ts`, `src/app/actions/cargo-estimates.test.ts`; 3 existing tests updated for the not-stackable default and new totals. 654 tests pass, typecheck and lint clean.

## Remaining Capacity Analysis (uncommitted, awaiting review)

- Engine: `Unit.preload` + `freeSpaces` (packages/solver/src/unit.ts); analysis `packages/solver/src/capacity.ts` (`analyseRemainingCapacity`, `checkAdditionalFit`, `detectUniformCargo`, `disjointBoxes`).
- App: `src/lib/remaining-capacity.ts` (adapter, provisional/stacking context, layout check), `src/components/use-remaining-capacity.ts`, `remaining-capacity.tsx`, `additional-cargo-check.tsx`; optional `proposed` outlines on `PlanDiagram`; panel rendered in the Calculate step (`plan-workspace.tsx`). `toSolverCargo`/`toSolverContour` exported from `solver-input.ts`.
- Tests: `packages/solver/src/capacity.test.ts` (28), `src/lib/remaining-capacity.test.ts` (12), 3 in `src/app/actions/cargo-estimates.test.ts`. 703 tests pass; typecheck and lint clean.

