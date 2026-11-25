# Assumptions

Compass stores length in centimetres and weight in kilograms. The workbook is already in centimetres. Conversion to millimetres, inches, or pounds happens only at the UI edge, and not in this phase.

The coordinate system used by later placement is:

- `x` grows from the front bulkhead toward the doors
- `y` grows across the width from the left wall
- `z` grows up from the floor

Axle `positionFromFrontCm` uses that same `x` axis.

## Workbook import

`Equipment_List_and_Dimensions.xlsx` is the system library. Sheet names map to modes:

| Sheet | Mode |
| --- | --- |
| Sea | `SEA` |
| Air | `AIR` |
| Land | `ROAD` |
| Pallets | `PALLET` |

The workbook id is stored as `externalId`. Names are kept as written, including "Tripple-decker". The same display name can exist on more than one sheet; mode plus external id keeps those rows apart. A row stays in the mode of its sheet. Sea-sheet chassis rows stay `SEA` even though they receive axle groups.

Air rows are then overwritten from `ULD_All_48_Dimensions_Master.xlsx` (see Air below). Length, width, height, payload, tare, and notes come from that master. The Air sheet still supplies the workbook id.

`orgId` is null for these system rows. Custom equipment created later belongs to an organization.

## Open height

When Height is empty, `heightOpen` is true and `innerHeightCm` is a planning stack cap, not a rated wall:

| Case | Cap |
| --- | --- |
| Road | 270 cm |
| Air without a ULD master height | 160 cm |
| Euro pallet and GMA pallet | 120 cm |
| Other pallet-sheet rows (roll-trailer bolsters) | 270 cm |
| Sea (platforms, roll trailers) | 270 cm |

Edit the numbers in `src/lib/equipment-defaults.ts` (`OPEN_HEIGHT_CM`).

## Payload, tare, and cost

The workbook has no payload or tare. Every figure below is a planning default, not a certified rating. Cost is a relative planning number with no currency.

Road, sea, and pallet rows have explicit defaults. Missing one fails the seed on purpose. Air rows use the name rules further down.

Axle `maxKg` limits apply to **cargo weight**. Tare is stored beside the payload and is not spread onto axles yet. Reference gross shown in the library is payload plus tare.

### Road

| External id | Name | Payload kg | Tare kg | Notes |
| --- | --- | --- | --- | --- |
| 11 | Box Trailer (EU) | 24,000 | 7,000 | 13.6 m reference. Kingpin at 160 cm / 12,000 kg, rear tandem at 1,180 cm / 18,000 kg |
| 185 | Curtain trailer (EU) | 24,000 | 6,800 | Semi axle formula |
| 216 | Megatrailer (EU) | 26,000 | 7,800 | |
| 1079 | Open Trailer (EU) | 24,000 | 6,200 | Open height, flatbed |
| 4142 | 48ft Semi (US) | 19,958 | 6,400 | About 44,000 lb |
| 1080 | 53ft Semi (US) | 20,412 | 6,800 | |
| 4323 | 48ft Flatbed Trailer (US) | 21,772 | 5,000 | Flatbed |
| 1076 | 53ft Flatbed Trailer (US) | 21,772 | 5,400 | Flatbed |
| 1075 | 53ft Step Deck Trailer (US) | 19,504 | 6,200 | Step deck |
| 1078 | Double Drop Trailer - Low Boy | 36,287 | 9,000 | Lowboy |
| 978 | 53ft High Cube Rail Container (US) | 27,216 | 5,500 | |
| 299 | Double Deck Trailer | 22,000 | 9,500 | Two floors. 400 cm is the full opening, not one deck |
| 15471 | 26ft Box Truck | 4,536 | 4,500 | Rigid axles |
| 1773 | 12m Semi Trailer (ZA) | 24,000 | 7,000 | Open height |
| 1772 | 18m Super Link Trailer (ZA) | 34,000 | 10,000 | |
| 1129 | Eastern Trailer | 18,000 | 6,000 | |
| 1130 | Eastern Trailer (tail) | 18,000 | 6,200 | |
| 484 | Superlink 1st (ZA) | 14,000 | 4,500 | Open height |
| 486 | Superlink 2nd (ZA) | 22,000 | 6,500 | Open height |
| 9 | Truck | 8,000 | 5,500 | Rigid axles |
| 1403 | VGK | 24,000 | 7,200 | |
| 13334 | Standard Chassis with 20ft DV | 21,770 | 3,200 | |
| 10 | Trailer | 18,000 | 6,500 | |
| 13335 | Standard Chassis with 40ft HC | 26,460 | 4,800 | |
| 5320 | 2ton Van Truck (CN) | 2,000 | 1,800 | Rigid axles |
| 5321 | 5ton Van Truck (CN) | 5,000 | 3,500 | Rigid axles |
| 14269 | RGN (Extendable) | 36,287 | 11,000 | Lowboy. Max length is sheet length plus 610 cm |

Other semi-trailers use two axle groups:

- Kingpin at 12% of length, clamped between 80 cm and 180 cm, limit 50% of payload
- Rear bogie inset by about 14% of length (between 140 cm and 220 cm), limit 75% of payload

Rigid trucks and vans (the name contains truck or van, and not trailer, chassis, flatbed, or RGN) use a front axle at 18% of length (45% of payload) and a rear axle at 78% (80% of payload).

### Sea

| External id | Name | Payload kg | Tare kg |
| --- | --- | --- | --- |
| 1 | 20ft DV | 21,770 | 2,300 |
| 2 | 40ft DV | 26,680 | 3,780 |
| 3 | 40ft HC | 26,460 | 3,900 |
| 24 | 45ft HC | 25,600 | 4,800 |
| 1167 | 20ft RF | 20,800 | 3,080 |
| 7010 | 40ft RF | 26,600 | 4,480 |
| 241 | 40ft RF HC | 25,900 | 4,900 |
| 4 | 20ft OT | 21,700 | 2,350 |
| 5 | 40ft OT | 26,600 | 4,000 |
| 6 | 20ft FR | 21,000 | 2,740 |
| 7 | 40ft FR | 26,500 | 5,000 |
| 25 | 40ft PL | 30,000 | 4,200 |
| 1215 | 40ft OT HC | 26,200 | 4,300 |
| 15336 | 20' Roll trailer - 25t | 25,000 | 3,500 |
| 15335 | 40' Roll trailer -100t | 100,000 | 12,000 |
| 979 | 53' High Cube Rail Container | 28,000 | 5,200 |
| 15334 | 62' Roll Trailer - 100t | 100,000 | 14,000 |
| 15333 | 72' Roll Trailer - 80t | 80,000 | 15,000 |
| 13333 | Standard Chassis with 20ft DV | 21,770 | 4,000 |
| 13332 | Standard Chassis with 40ft HC | 26,460 | 5,500 |

Roll-trailer payloads follow the tonnage in the name. Chassis rows on the Sea sheet get the semi axle formula so a road leg can be checked later.

### Pallets

| External id | Name | Payload kg | Tare kg | Open height |
| --- | --- | --- | --- | --- |
| 1293 | Euro pallet | 1,500 | 25 | 120 cm |
| 1294 | GMA Standard Pallet | 1,361 | 20 | 120 cm |
| 12123 | Double-decker bolster for Rolltrailer | 25,000 | 800 | 270 cm, one floor |
| 12106 | Tripple-decker bolster for Rolltrailer | 25,000 | 1,100 | 270 cm, one floor |

The bolster names describe the hardware. They are not modeled as multi-floor containers.

### Air

`ULD_All_48_Dimensions_Master.xlsx` is the planning source for all 48 air types. Seed matches each Air-sheet name (whitespace-normalized) to that master. Millimetres become centimetres (`÷ 10`).

- Planning envelope = internal/usable L/W/H when present, otherwise external/base L/W and external/max H
- Payload and tare come from the master. Missing tare is stored as 0
- Pallet families (PMC, PAG, PAQ, PGA, PLA, PRA, PYB) stay `heightOpen` even when a usable height is published — that height is the stack envelope, not a wall
- Contour ULDs use one extruded body. LD-3 / AKE has a Cargo-Planner bottom-right slope of 450 × 510 mm; the displayed volume is 4.3 m³ after that triangular cut. A2N uses the Cargo-Planner inner envelope 317 × 223 × 205 cm (not the FRAYTE wall-inset usable) and a house roof: top left/right 1075 × 910 mm, volume 12.3 m³. AAN uses top left/right 355 × 355 mm. LD-11 stays a closed box
- Sea, road, and pallet inner sizes, payload, tare, and door openings are overlaid from the [Cargo-Planner equipment library](https://cargo-planner.com/equipment-library/) (containers, ULDs, trailers, pallets only — no aircraft, vessels, or road trains). An admin can change those values or add a new type; contours live on the equipment row so 3D follows the database
- Notes keep source, published volume, floor height, and the workbook remark

Name-only payload fallbacks in `equipmentPhysics` are used only if a master row is missing. Seed fails if an Air name has no master match.

## Out of gauge class

Inferred from the name, for later assignment of cargo that exceeds a closed envelope:

- Low boy, double drop, RGN → `LOWBOY`
- Step deck → `STEPDECK`
- Flatbed, flat rack, platform, open trailer, roll trailer, `FR`, `PL` → `FLATBED`
- Open top, `OT` → `OPEN_TOP`
- Otherwise `NONE`

## Planner flow

A load plan has four steps, matching the dock-floor briefing:

1. **Data** — cargo table and Excel/CSV import
2. **Setup** — pick primary equipment (and optional secondary pallets)
3. **Workspace** — unit table plus a 3D preview of each packed unit
4. **Load plan** — isometric 3D, top/side/front views, axle loads, loading sequence

The solver packs **primary** equipment only in this phase. Secondary types are stored for later nesting. Solving runs in a Web Worker when the browser allows it, then the result is saved on the server.

## Cargo units

**Storage never changes.** Cargo sizes are stored in centimetres (`lengthCm`, `widthCm`, `heightCm`), the solver works in centimetres, weight is kilograms and volume cubic metres. The unit chosen in the Cargo page's **Sizes in** list only decides how a size is typed and shown. Handling clearance is always entered and shown in centimetres.

### Supported length units

| Unit | Centimetres | Notes |
| --- | --- | --- |
| mm | 0.1 | |
| cm | 1 | the stored unit |
| m | 100 | |
| in | 2.54 | |
| ft | 30.48 | decimal feet, or feet and inches |

All five are converted by one table in `src/lib/cargo-units.ts`. The Cargo grid, the packing-list importer, the exports, the plan pages, the equipment catalogue and the 3D labels all use it; there is no second copy of the factors. Weight on import accepts kg or pounds (`× 0.45359237`).

### Typing a size

- **A plain number** is in the selected unit. `5.6` with feet selected is five and six tenths feet (170.688 cm). It is never read as 5 ft 6 in.
- **Feet and inches** are written together: `5 ft 6 in`, `5ft6in`, `5'6"`, `5' 6"`, `5'6`, `5 ft 6.5 in`. Feet must be a whole number and inches must be under 12; `5 ft 14 in` is refused as a probable slip. `5'` alone is five feet and `6"` six inches. `5 ft 6` without `in` or `"` is refused rather than guessed.
- **A unit written after the number** (`120 cm`, `1200 mm`, `4 ft`) is read as that unit, whichever unit is selected, because the text says so itself.
- A decimal comma (`5,5`) is accepted. Negative numbers and anything unreadable are refused with a reason; the box is put back to the stored value when it is left.
- Typed values are converted to centimetres and kept to 0.0001 cm, which removes floating-point noise without losing anything real.

### Switching the displayed unit changes nothing stored

Switching the unit only formats the stored centimetres again; no cargo line is saved, nothing is rounded and written back, and no plan is marked out of date (a plan's status depends only on the cargo facts and the clearance configuration, never on the display unit). A stored size changes only when a new one is typed. Showing a size, clicking into a box and out again, or typing back exactly what is shown leaves the stored value as it was, so switching between centimetres and feet repeatedly cannot drift. The display rounds (mm 1 decimal, cm 1, in 2, ft 3, m 3); the stored value does not.

The choice is a browser preference shared by every screen (key `compass.cargo.lengthUnit`, unchanged from before). Cargo grid, equipment catalogue, Calculate and Load plan tables, Playground piece details, the clearance editor and Manage clearances, the 3D dimension labels and the Excel plan export follow it. The printed report is produced on the server, so it states centimetres explicitly.

### Import and export

- **Unit choice.** The import wizard offers all five units. A unit written in the size column titles (`Length (ft)`, `W inches`, `Height mm`) is used as the suggestion; if the titles name different units, or none, nothing is chosen for you and the wizard says so. A unit written in a cell is read as written. A plain number is read in the unit shown.
- **Thousands separators** (`1,200`) are still accepted in imported cells.
- **Saved column mappings** from before feet existed stay valid.
- **Cargo export** writes sizes in the selected unit with the unit in each size title (`Length (ft)`), at 12 significant digits. In centimetres the export is exactly what it was. Importing an export reads the unit from its titles, so a round trip changes no size by more than the stored precision.
- **Excel plan export** writes sizes and positions in the selected unit with the unit in every title, and a Units note on the Notes sheet. Clearance, weights (kg) and volumes (m³) keep their units.
- **Packing lists read by the AI** are still converted to centimetres by the reader and flagged for review.

## Packing-list import

One dialog (Cargo step, **Import packing list**, or drop a file or paste an image anywhere on the page) with three ways in: **Upload file**, **Paste image** and **Paste text**. Every way ends in the same review screen, and **nothing is saved until the planner imports**.

### Which reader handles what

| Input | Reader | Sent outside? |
| --- | --- | --- |
| Excel (.xlsx), CSV | Deterministic: header detection, column mapping, saved templates | No. Works with no API key. |
| Excel the mapper cannot interpret | Optional: "Read this sheet with AI instead" sends the chosen sheet's cell values as text | Yes, to the AI provider, only on the planner's click |
| PDF, JPG, PNG, WebP, GIF | AI provider (Claude) | Yes, only on the planner's click |
| Pasted text | AI provider (Claude) | Yes, only on the planner's click |

The dialog says so before any request. Spreadsheets are never sent to the AI unless the planner asks.

### Spreadsheets

- Header rows are found anywhere on a sheet (title blocks above are skipped). A sheet can hold several tables; each header row starts one. Every sheet is listed and the planner picks the worksheet and table.
- Merged cells are filled across their block. Blank rows are ignored. Rows that read Total, Sub total, Grand total (also in French, German, Spanish, Chinese and Arabic), and rows that have only numbers and no description or size, are **left out** and listed. A stated total is kept to compare with the lines.
- A size in one cell (`120 x 80 x 60 cm`, `1.2 x 0.8 x 0.6 m`, `5 ft 6 in x 3 ft x 2 ft`) is split. A unit written once covers all three; a unit on each part stays with it.
- A line total weight column is divided by the quantity only after the planner confirms it in the review.
- Formulas are not read or run: only the values the file already holds. Macro workbooks and external parts are refused. Limits: 5 MB, 25 sheets, 5,200 rows and 120 columns per sheet, 400 zip parts, 80 MB unpacked and a 150:1 squeeze ratio. A sheet over the row limit is refused, never cut short.
- The `xlsx` package (0.18.5) is an old release with published weaknesses (prototype pollution, regex slowness). The limits and the zip check above keep hostile files away from it, and sheet names such as `__proto__` are never used as keys. A newer SheetJS build is only published outside npm; replacing the dependency needs a decision (see the progress notes).
- Numbers in spreadsheet cells follow the English convention the importer has always used (dot decimal, comma thousands) and are not flagged as ambiguous.

### Reading by AI

- The model is asked for values **exactly as written** (`150 kg`, `5'6"`, `1.200,5`), not converted. The same code that reads the Cargo grid converts them, so feet and inches, decimal feet, mm, m and in behave identically everywhere.
- Weights in kg, g, tonnes (`t`) and pounds are converted to kg (`ton` is refused: short, long and metric differ). Compass stores kg.
- A unit that is not written in the document is **never assumed**: the line is flagged "Ambiguous value" and the planner chooses.
- Per piece, line total and unclear weights are kept apart. A line total becomes a per-piece weight only when the quantity is known, is shown as "calculated by Compass" with the working (`750 kg ÷ 5 pieces = 150 kg per piece`), and needs confirming. A shipment total is never spread across lines. Net weights are flagged until confirmed. Quantity × weight is compared with a line total and with the document's totals; differences are shown, not changed.
- A number like `1,200` or `1.200` can be read two ways. It is read the English way, flagged, and the planner confirms it. A number starting with 0 (`0.777`) is a decimal.
- Hazard class, stackability, floor-only, turning and clearance are applied only when the document states them for that line. Handling notes and a destination that is a place name are kept for reading in the review and are **not** stored on the cargo line (no schema change). "This side up" means the piece may still turn on the floor (`ROTATE_90`); "do not rotate" means `FIXED`.
- Original descriptions and marks are kept as written. A translation is shown beside, never over, the original.
- Statuses: Ready for review, User corrected, Missing required information, Ambiguous value, Invalid value, Excluded from import. "Model-reported uncertainty" is shown separately from "checks Compass made itself". Source page, row and quote are shown only when the reader gave them; none are invented and no confidence percentages are shown.
- Everything in a document or pasted text is data, never an instruction: the prompt says so, pasted text is fenced so it cannot close its wrapper, the answer is validated against a schema before use, control and direction-override characters are removed, and all text is shown as plain text.

### Limits and honest gaps

- PDFs: up to 10 MB and (default) 30 pages, judged from the file's structure. A longer PDF is refused with a message, not cut short. Splitting a PDF into page batches, and extracting text locally, would need a PDF library that is not installed, so **page batching is not implemented**.
- Images over 5 MB are shrunk in the browser first. Rotation and poor lighting are left to the model; unreadable parts are reported, not guessed.
- Pasted text: 30,000 characters. A reading returns at most 500 lines and says when more were left.
- Cancel stops waiting for an answer. A request already sent may finish on the server and cost a request.
- One reading runs at a time per person and content: a repeated click joins the one running.
- Multilingual reading is built for (descriptions, numbers, units, headers in several languages) but **its accuracy has not been measured** on representative documents.
- No live Claude call has been made during development; every AI path is tested with a stand-in client.

### Saving

- Only included, complete, validated lines are saved, and the server checks every line again (size and weight above zero, a name or mark, project access in the planner's organization).
- **Append** adds the lines. **Replace** needs an explicit confirmation and runs removal and creation in one transaction, so a failure leaves the cargo as it was. Replacing also removes the old lines' places in any saved plan (they are deleted with the lines), so the plan is out of date and must be calculated again.
- Repeated lines (same mark, name, size and weight) and lines already in the project are pointed out, never removed. Several lines may share a SKU.
- Importing changes the cargo signature, so the existing plan shows as out of date through the usual plan-status mechanism; nothing is recalculated automatically. Equipment suggestions are computed from the cargo and follow it. Project clearance applies unless the document stated a clearance for the line.
- The saved display unit is not changed by an import.

### Configuration

`ANTHROPIC_API_KEY` (server only), `COMPASS_AI_PROVIDER` (default `anthropic`), `COMPASS_AI_MODEL` (default `claude-sonnet-5-5`), `COMPASS_AI_TIMEOUT_MS`, `COMPASS_AI_MAX_PDF_PAGES`. Documented in `.env.example`. A provider other than `anthropic` reports "not available" until one is written against `src/lib/extraction-provider.ts`.

## Auth and database

Local demo organization id is `org_compass_demo`. Accounts, all with password `compass-demo`:

- `admin@compass.local` — admin
- `planner@compass.local` — planner
- `viewer@compass.local` — viewer

Change these before any shared deployment. Sessions are JWT credentials sessions. Roles are strings in SQLite (`ADMIN`, `PLANNER`, `VIEWER`) so the schema stays valid on Postgres, where they can become enums.

SQLite is the local database. JSON columns hold axle groups, rules, and plan metrics. Floats are used for dimensions and the relative cost figure.

## Floor utilization and handling allowance

Every unit shows two floor figures. They come from one shared function (`floorUtilization` in `packages/physics/src/footprint.ts`), so the Calculate table, the Load plan, the Playground, the Excel export, the printed report and the saved plan always report the same numbers for the same layout.

### Footprint convention

Whatever its shape, a piece occupies the rectangle `l × w` of its placed bounding box (the solver has always done this). A drum is therefore a square footprint, not a circle, and a pipe is its length by its diameter. The entered external dimensions are used as they are: packaging that is already inside them is not added again. All lengths are centimetres.

A piece counts as standing on the floor when its underside is within 0.5 cm of the floor (`FLOOR_CONTACT_TOLERANCE_CM`). Stacked or raised pieces do not occupy floor directly and are left out of both figures.

### Actual floor utilization (%)

```
actual % = area( union of [x, x + l] × [y, y + w] over floor pieces ) / (unit length × unit width) × 100
```

The union is exact (no grid, no rounding of positions or sizes) and counts overlapping footprints once. Before this change the Playground estimated the figure on a 5 cm grid and rounded every piece outward, so it read higher than the Load plan for the same pieces (for example 15.8% against 13.8%), and a saved layout never refreshed the stored figure.

### Effective floor utilization (%)

```
effective % = area( union of [x − a, x + l + a] × [y − a, y + w + a] over floor pieces ) / (unit length × unit width) × 100
```

`a` is the piece's handling allowance (below). The grown rectangles are not clipped to the unit, so a piece whose allowance reaches past a wall still shows in the number, and is reported as a clearance problem instead of being hidden. Where two pieces share a gap the shared area is counted once. With no allowance the two figures are identical.

### Handling allowance

The allowance is operational spacing kept free around a piece: room for forks, hands or lashing. It is not packaging. Wrapping, crating or pallets already included in the entered sizes must not be entered again.

- **Per side.** An allowance of 5 cm keeps 5 cm free on every side of the piece (10 cm added to its length and to its width).
- **Walls.** A piece keeps its full allowance against the unit walls, so its grown rectangle must stay inside the unit.
- **Neighbours.** The gap is shared: two pieces that are beside each other must be at least `max(a₁, a₂)` apart, not `a₁ + a₂`. A piece with no allowance still respects a neighbour's allowance.
- **Height.** It applies between pieces that share some height. A piece resting on another needs no clearance from it. Clearance is horizontal only; it is not applied to the roof.
- **Never support.** Stacking support, overhang and stability use the physical footprint only. A clearance margin never counts as something to rest on.
- **Shapes.** The check uses the bounding rectangle for boxes, drums and pipes, like the solver. (With no allowance the Playground still lets round drums sit closer than their bounding squares, as before.)

Where it is set:

| Level | Where | Stored in |
| --- | --- | --- |
| Project default | Workspace step, "Handling allowance" (cm per side). Default 0. | `Project.rules` JSON as `{ "clearanceCm": n }` |
| One cargo line | Data step, Advanced columns, "Clearance" (opens the clearance editor), or Manage clearances. Default, uniform (0 means none for that line) or directional; see below. | `CargoItem.customFields` JSON as `{ "clearanceCm": n }` or `{ "clearanceSides": {…} }` |
| Used by a plan | Recorded when the plan is calculated. If the project default changes later the plan is marked out of date until it is recalculated. | `Plan.settings.clearanceCm` |

No database migration is involved: the values live in existing JSON columns, and a missing value means 0, so projects and plans saved before this feature behave exactly as before. Allowed range is 0 to 100 cm.

The solver places each piece inside the space left after the allowance to the walls and to its neighbours, and cuts free space by the grown rectangle. A piece that fits the unit physically but not with its allowance is reported as not loaded with the reason `CLEARANCE`. The Playground refuses a drop that breaks the rule ("Needs N cm more clearance from …", "Clearance reaches N cm past the wall"), and flush snapping to walls and neighbours stops at the allowance.

### Clearance modes per cargo line, and directional clearance

Each cargo line is in one of three modes:

| Mode | Meaning | Stored in `CargoItem.customFields` |
| --- | --- | --- |
| **Default** (inherit) | Uses the project default and follows it when it changes. | neither key |
| **Uniform** | One value on all four sides. `0` is an explicit "none for this line" and is **not** the same as inheriting: it stays 0 when the project default changes. | `{ "clearanceCm": n }` |
| **Directional** | Separate front, rear, left and right values. | `{ "clearanceSides": { "front", "rear", "left", "right" } }` |

Directional values win over a leftover uniform number. Older projects only ever have `clearanceCm` (or nothing), which read exactly as before. Values are 0 to 100 cm; anything negative, non-numeric or incomplete is ignored (the line inherits) when read, and refused when saved. A change to a line applies to every piece of that line, whatever its quantity and whichever unit holds it. It reserves handling space only: it adds no weight, volume or packaging and is never support.

**The sides belong to the piece, as it was entered.** Front is the end of the piece's length that faces the front of the unit when it is placed as entered (rotation `LWH`), rear faces the doors, left is the low-y side and right the high-y side. They turn with the piece:

| Rotation code | What it is | Front faces | Rear faces | Left faces | Right faces |
| --- | --- | --- | --- | --- | --- |
| `LWH` | as entered | front of unit | doors | left wall | right wall |
| `WLH` | quarter turn clockwise seen from above | left wall | right wall | doors | front of unit |
| `LWH@180` | half turn | doors | front of unit | right wall | left wall |
| `WLH@180` | three quarter turns | right wall | left wall | front of unit | doors |

The two `@180` codes are the same footprints as `LWH` and `WLH` facing the other way. They are only offered by the packer, and accepted by the server, for lines whose four values differ and whose orientation is not `FIXED`; a uniform line looks the same turned either way, so its rotation codes and results are exactly what they were before. The Playground's **Rotate 90°** steps a piece with differing values through all four facings.

**A piece tipped onto another face** (`LHW`, `HLW`, `WHL`, `HWL`; its height is no longer vertical): its own front, rear, left and right no longer line up with the four plan sides, and two of its faces now point up or down where floor clearance has no meaning. Nothing is discarded and nothing is guessed: **the largest of the four values is applied on every side.** This is conservative (it never reserves less than any value that was entered) and does not depend on which way the piece was tipped. The same rule applies to a rotation code that cannot be read.

**Shared gaps between neighbours.** The space reserved around a piece is its footprint grown by each side's own value. Two pieces at the same height are valid when neither one's physical box is inside the other's reserved space. Where two sides face each other this means the gap must be at least the larger of the two facing values, never their sum. Sides that do not face the neighbour do not matter, and a line set to 0 must still stay out of a neighbour's reserved space. Against a wall each side keeps its own value, so a piece that needs room at the front can stand hard against the rear wall.

**Reserved space overlapping is normal.** Two neighbouring pieces share the gap between them, so their amber frames in the 3D view overlap on purpose. Red marks a piece whose reserved space is actually broken. In the effective floor figure overlapping reserved space is counted once.

The same functions decide all of this everywhere (`packages/physics/src/footprint.ts` for geometry, `clearance-model.ts` for modes and rotation): the packer, equipment recommendations (each trial run uses the project's and every line's settings), the Playground's drop check, snapping and free-spot search, the server's save check, the effective floor figure and the 3D frames.

### One saved configuration, and when a plan is out of date

The project default (`Project.rules.clearanceCm`) and each line's setting are the single source of truth for the Cargo page, Manage clearances, the Calculate and Load plan pages and the Playground. A plan records, in `Plan.settings`, the cargo it was calculated from (`cargoSignature`) and the clearance configuration it was calculated or last checked under (`clearanceCm`, `clearanceConfig` with the default and every line's own setting), plus `layoutSource`.

A plan is out of date when **either** the cargo facts that decide packing differ from the signature (lines added or removed, sizes, weights, quantities, orientation, stacking and priority rules; names, SKUs, colours and clearance are not part of it) **or** the configuration now in force differs from the recorded one. They are tracked separately on purpose: re-checking a layout under new clearances updates the recorded configuration only, so it can never hide an unrelated cargo edit. The banner says what differs ("project default 2 → 5 cm, 3 cargo lines with a different clearance"). Plans saved before signatures fall back to edit times (and to the project default alone if they have no recorded configuration). `src/lib/plan-staleness.ts` is the one place this is decided.

### Plan status

One status is shown everywhere (`src/lib/plan-status.ts`): the stepper, the Calculate page, the Load plan page, and the project list (which uses the same staleness rule).

| Status | When |
| --- | --- |
| Not calculated | There is no plan. |
| Calculating… | A calculation, or a clearance change being saved and applied, is running. |
| Plan ready | A plan exists and matches the project's cargo and clearance configuration. |
| Out of date | A plan exists but the cargo or the clearance configuration changed since. |
| Calculation failed | The last calculation or recalculation failed. A previous plan, if any, is still shown but is never reported as ready. |

A clearance change that is **rejected** (the current layout cannot keep it) saves nothing, so it does not change the status at all: a ready plan stays ready and an out-of-date plan stays out of date. "Keep current layout" and Save & Recalculate return the plan to ready only when it then matches the project; an unrelated cargo edit keeps it out of date.

### Applying clearance changes

**Manage clearances** (next to the project allowance on the Calculate and Load plan pages) shows the project default and every cargo line (searchable, 100 at a time) and uses the same editor as the Cargo page. Edits, and the project default field, are collected and applied together; nothing runs per keystroke.

- **No calculated plan:** the settings are only saved. The packer is not run.
- **A calculated plan, automatic or hand-arranged:** the same dialog, "Apply clearance changes", offers three choices. A hand-arranged plan also shows a warning that recalculating replaces the arrangement.
  - **Cancel** persists nothing. The saved settings, layout and plan are exactly as they were.
  - **Keep current layout** checks every piece in every unit against the new settings. If all of them still have their room, the settings are saved, every metric is recalculated, the recorded configuration is updated, and no position, turn or facing changes (the packer is never run). If any piece does not, nothing is saved and nothing moves; the pieces are listed, and the proposal stays on screen as a draft (below).
  - **Save & Recalculate** saves everything in one transaction and runs the packer once, with exactly the configuration the server stored. If the recalculation fails, the settings stay saved, the previous plan stays on screen marked out of date and the status is "Calculation failed", with a **Retry recalculation** button.
- While a request runs a status line is shown and the actions are disabled; a second request is refused.

**A rejected proposal is a draft.** The message says it was not saved and nothing changed, shows what was proposed and which pieces (with their unit) break it, and offers **Fix in Playground**, **Save & Recalculate instead** and **Discard proposed changes**. Fix in Playground opens the Load plan on the first affected unit with the proposal applied as an unsaved draft: the broken pieces are red, the draft is shown, and Reset layout discards it. When the layout is valid again, saving the layout saves the draft settings with it. The server re-checks everything and stores nothing unless the whole arrangement is valid, so an invalid layout can never be saved as a valid plan.

**Hand-arranged layouts.** A plan is *automatic* until a saved layout edit moves cargo, after which it is marked `MANUAL` in `Plan.settings.layoutSource` (existing JSON, no migration; plans saved before this are automatic). Saving a layout never re-runs the packer.

**In the Playground** a line's clearance can also be edited from the selected piece (it applies to all pieces of that line). It is pending like a moved piece: the layout is re-checked live, pieces whose reserved space is broken turn red, nothing is repositioned, Undo / Reset layout discard it, and it is saved together with the layout.

**A layout save checks every unit when the configuration differs from the one the plan was last checked under**, not only the unit that was sent, so a plan is never recorded as checked against settings that one of its units breaks.

### One minimum support share

The smallest share of a stacked piece that must rest on something is a **planning constraint, not a guarantee of physical stability**: an area ratio plus a check that the centre of gravity is over the support. It does not model friction, load shift, vibration or securing, and a layout that passes it is not thereby safe to ship.

There is one default, **75%** (`DEFAULT_MIN_SUPPORT_PCT`, the packer's own, stricter value), and one way of resolving it (`resolveMinSupportPct`): the project's own setting (`Project.rules.minSupportPct`, 50 to 100) when it has a valid one, otherwise 75%. The packer, the Playground's drop check, its keyboard moves, rotation and add-back (which used to use a fixed 70%), the free-spot search and the server's save check all use that resolved value. A project with no setting therefore gets 75% everywhere; a project with an explicit setting keeps it everywhere.

- The Playground starts from the project's value every time it opens; a number left in the browser from earlier is not used.
- A value sent by the browser with a layout save must be a number from 50 to 100 or the save is refused. It is the planner's explicit change to the project's setting: it is used for that save and stored, so afterwards the packer, the Playground and the server all use it. The default (75%) is never written to the project, so saving a layout alone never changes how the packer behaves. Only planners and admins can save.
- A stored value outside 50 to 100 is ignored (75% applies).
- Support is one rule among several: collisions, walls, clearance, stacking, floor-only and rotation checks are unchanged by it.
- Layouts saved earlier under the old 70% Playground/server default may be refused if a piece in them is moved, or something under them moves, and they have between 70% and 75% support. A piece already in that state that is not touched does not block a save.

### Limitations added or confirmed by this work

- Rotation facing (`@180`) and the per-side values are stored in existing text and JSON fields. A piece edited outside the app, or a rotation code from another version, that cannot be read is treated as tipped: the largest value applies on every side.
- Directional values of a tipped piece are collapsed to their largest value, so a piece that must be tipped can need more room than its entered values suggest. This is accepted for the current scope.
- A line with a fixed orientation keeps exactly the orientation it was entered in: the Playground refuses to turn it, and the server refuses a save in which it is turned or faces the other way, even when its footprint is square.
- The Excel packing list shows each piece's rotation code and, beside it, the facing in words (as entered, turned 90°, 180°, 270°, or tipped onto another face).
- Older rotation codes (`LWH`, `WLH`) are unchanged and read as before.
- The packer offers all four facings only to pieces whose values differ. For very tight mixed loads its greedy placement can leave more cargo unloaded than an optimal packer would.
- "Keep current layout" and the server check judge the layout as it is; they do not try to move cargo to make room.
- Which plan is "hand-arranged" is recorded when a saved layout edit moved something; a plan edited before this release is treated as automatic.
- The loading sequence number is still not stored in the database: after a reload it is the order the pieces are read back.
- A freshly calculated plan is stored as the browser sent it; only hand-edited layouts are re-validated by the server.
- The Cargo grid's Clearance column, the editor and the Manage clearances panel have been checked by automated tests of their logic and by manual testing, not by browser automation.
- Axle loads remain a planning estimate (cargo weight only, simple beam model, rear groups sharing equally). They are shown as estimates and as warnings, and are not an operational, legal or safety compliance check.

### Metrics recalculated on every change

`computeUnitMetrics` (`packages/solver/src/unit-metrics.ts`) turns a list of placed pieces into every unit figure: weight, remaining payload, volume, remaining volume, both floor figures, centre of gravity, estimated axle loads and the used length, width and height. The solver, the Playground (`liveMetrics`) and the server all call it.

- In the Playground the figures are recomputed from the pieces on every accepted change: move, turn, set aside, add back, undo and reset. Nothing is cached, so undo and reset return exactly the earlier numbers, and the packing algorithm is never re-run on a hand-arranged layout.
- `savePlanLayout` does not trust the client. It checks the final layout with the same physics as the Playground (walls, collisions, handling allowance, support, stacking, floor-only pieces, allowed turns), recalculates every figure and stores positions, metrics and warnings together in one transaction. The Load plan table and header are updated from what the server returns, and a reload reads the stored figures.
- A piece that was already invalid in the plan being replaced (for example from an older version) does not block a save unless it is the piece being moved, or something moved away from under it.
- Plans saved before the two figures existed have only `floorPct`, which was the exact figure. They are read with both figures equal to it.

### Known limitations

- **Axle loads are a planning estimate, not a verified weighing and not a compliance check.** They use a simple beam model on cargo weight only: tare, tractor and fifth-wheel loads are not included, and with three or more axle groups the rear groups are assumed to share the load equally. They are shown as estimates and as warnings only. They must not be used to certify axle or gross weights.
- Payload and axle overloads are reported as warnings in the saved plan, not refused on save (the Playground can also be set to a non-strict mode).
- The server does not validate loading order, destination (stop) order, or the ULD contour shape of hand-moved pieces, which matches what the Playground checks.
- The loading sequence number is not stored in the database; after a reload it is the order the pieces are read back.
- The server checks a hand-edited layout; a freshly calculated plan from the solver is still stored as sent by the browser.
- The check of a saved layout uses the project's minimum support share (see "One minimum support share" below), the same value the Playground uses and, when the project sets one, the packer.
- The packer's handling of mixed allowances is greedy: it slides a piece past a neighbour along the length, then the width. In very tight loads this can leave more cargo unloaded than an optimal packer would. It never produces a layout that breaks the rule.
- Costs, payloads and axle limits remain planning defaults, not certified ratings.
