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

**Storage never changes.** Cargo sizes are stored in centimetres (`lengthCm`, `widthCm`, `heightCm`), the solver works in centimetres, weight is kilograms and volume cubic metres. The unit chosen in the Cargo page's **Sizes in** list only decides how a size is typed and shown.

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

Switching the unit only formats the stored centimetres again; no cargo line is saved, nothing is rounded and written back, and no plan is marked out of date (a plan's status depends only on the cargo facts, never on the display unit). A stored size changes only when a new one is typed. Showing a size, clicking into a box and out again, or typing back exactly what is shown leaves the stored value as it was, so switching between centimetres and feet repeatedly cannot drift. The display rounds (mm 1 decimal, cm 1, in 2, ft 3, m 3); the stored value does not.

The choice is a browser preference shared by every screen (key `compass.cargo.lengthUnit`, unchanged from before). Cargo grid, equipment catalogue, Calculate and Load plan tables, Playground piece details, the 3D dimension labels and the Excel plan export follow it. The printed report is produced on the server, so it states centimetres explicitly.

### Import and export

- **Unit choice.** The import wizard offers all five units. A unit written in the size column titles (`Length (ft)`, `W inches`, `Height mm`) is used as the suggestion; if the titles name different units, or none, nothing is chosen for you and the wizard says so. A unit written in a cell is read as written. A plain number is read in the unit shown.
- **Thousands separators** (`1,200`) are still accepted in imported cells.
- **Saved column mappings** from before feet existed stay valid.
- **Cargo export** writes sizes in the selected unit with the unit in each size title (`Length (ft)`), at 12 significant digits. In centimetres the export is exactly what it was. Importing an export reads the unit from its titles, so a round trip changes no size by more than the stored precision.
- **Excel plan export** writes sizes and positions in the selected unit with the unit in every title, and a Units note on the Notes sheet. Weights (kg) and volumes (m³) keep their units.
- **Packing lists read by the AI** are still converted to centimetres by the reader and flagged for review.

## Packing-list import

One dialog (Cargo step, **Import packing list**, or drop a file or paste an image anywhere on the page) with three ways in: **Upload file**, **Paste image** and **Paste text**. A spreadsheet then goes through a column-mapping step in the same dialog. Every way ends in the same **review**, which opens on the Cargo page under the cargo grid, not in a modal, so many lines can be seen at once. **Nothing is saved until the planner adds the lines.**

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
- Weights: the plain **Weight** column (the Compass template's) is per piece. A column that says per piece, each or per package is per piece. A **Gross weight** column that does not say what it is for is left unclear, which only matters when the quantity is above one. A **Total weight** column is the line total. A **Net weight** column is kept as reference. A cell that holds both (`2210 net / 2360 gross`) is separated into the two numbers.
- Formulas are not read or run: only the values the file already holds. Macro workbooks and external parts are refused. Limits: 5 MB, 25 sheets, 5,200 rows and 120 columns per sheet, 400 zip parts, 80 MB unpacked and a 150:1 squeeze ratio. A sheet over the row limit is refused, never cut short.
- The `xlsx` package (0.18.5) is an old release with published weaknesses (prototype pollution, regex slowness). The limits and the zip check above keep hostile files away from it, and sheet names such as `__proto__` are never used as keys. A newer SheetJS build is only published outside npm; replacing the dependency needs a decision (see the progress notes).
- Numbers in spreadsheet cells follow the English convention the importer has always used (dot decimal, comma thousands) and are not flagged as ambiguous.

### Reading by AI

- The model is asked for values **exactly as written** (`150 kg`, `5'6"`, `1.200,5`), not converted. The same code that reads the Cargo grid converts them, so feet and inches, decimal feet, mm, m and in behave identically everywhere.
- Weights in kg, g, tonnes (`t`) and pounds are converted to kg (`ton` is refused: short, long and metric differ). Compass stores kg.
- A unit that is not written in the document is **never assumed**: the numbers are kept as read, the cells are highlighted and the planner chooses. A unit stated once for the whole table (a column title or a note, `tableSizeUnit`) is used for the lines that state none, and the line says so. One choice of unit in the review covers every row without one. Sizes keep the order the document gives; nothing is inferred about how a package may be turned.
- **Gross and net are separate numbers.** The reader is asked for `grossWeight` (with packaging), `netWeight` and, for a weight with no label, `weight`, each as one number with its unit, never joined (`2210 net / 2360 gross` is two fields). If a reading still joins them, `splitNetGross` separates them, so a joined cell no longer blocks a line. Planning uses the **gross** weight when there is one; the net weight is kept as reference and shown in the details. A line with only a net weight uses it only after the planner confirms. A net weight above the gross weight is flagged.
- **What a weight is for.** The reader reports `weightScope` (per piece, line total, or unclear) and the words that say so (a column title or a quote). With a **quantity of 1** the distinction does not exist, so nothing is asked. With a quantity above 1: per piece is used directly; an explicit line total is divided by the quantity (shown as a note, not a blocker); when the document does not say, the number is kept as read and the planner chooses each or total, and the line stays unsettled until they do. A weight is never silently assumed to be per piece, and never multiplied. A shipment total is never spread across lines.
- A number like `1,200` or `1.200` can be read two ways. It is read the English way, flagged, and the planner confirms it. A number starting with 0 (`0.777`) is a decimal.
- Hazard class, stackability, floor-only and turning are applied only when the document states them for that line (stacking not stated is planned as not stackable; see below). Handling notes and a destination that is a place name are kept for reading in the review and are **not** stored on the cargo line (no schema change). "This side up" means the piece may still turn on the floor (`ROTATE_90`); "do not rotate" means `FIXED`.
- Original descriptions and marks are kept as written. A translation is shown beside, never over, the original.
- Statuses in the table: OK, Edited, Missing, Check, Invalid, Excluded (hover for the full wording). "Model-reported uncertainty" is shown separately from "checks Compass made itself". Source page, row and quote are shown only when the reader gave them; none are invented and no confidence percentages are shown.
- Everything in a document or pasted text is data, never an instruction: the prompt says so, pasted text is fenced so it cannot close its wrapper, the answer is validated against a schema before use, control and direction-override characters are removed, and all text is shown as plain text.

### The review

- **A compact table**, like the Cargo grid: select, mark, name, L, W, H, kg per piece, quantity, stackable, status, row actions. Cells are edited in place; a typed size is read in the unit the column heading shows (`L (ft)`), and a typed weight is the planning weight of one piece in kg. The heading follows the saved display unit; the original numbers and units are kept (see **Details** on a row: original values, size and weight units, gross or net, what the weight is for, shape, stacking, floor-only, turning, hazard class, handling notes and the reader's doubts).
- **One "Please check" box** (collapsible, closed by default on a long list) folds the problems into three kinds, each said once with the rows it applies to: missing or invalid (fix), needs your confirmation, and for your information (unit conversions, a weight worked out from a line total, a net weight kept as reference). Only the affected cells are highlighted; selecting one says why.
- **View original** (and the magnifier on a row) opens the original PDF, image, sheet or text in a separate dialog at the page, row or quote the reader reported. Closing it loses nothing. PDFs use the browser's own viewer, so zoom and page navigation work.
- **One summary line** under the table: lines selected, pieces, kg, m³ and lines needing review, recalculated on every edit, selection and exclusion. A line whose quantity is known always counts its pieces. Weight counts only settled weights and volume only known sizes; the line says how many lines are left out ("partial").
- **Add lines and suggest equipment** needs every selected line complete. **Add lines only** also accepts incomplete lines as drafts (below). Append or replace is offered when the project already has cargo; replacing needs confirmation. Back and Cancel change nothing.

### Packages, estimates and what the document does not say

Every value in the review is one of four kinds, and the table shows which: **as in the document** (plain), **worked out** (blue `calc`, e.g. a per-piece weight from a line total), **estimated** (dashed amber `est.`, never treated as confirmed) or **missing** (red).

- **One line per marked package.** A line whose mark is a range (`S-1 to S-6`, `S-01 – S-03`, `C1-4`) and whose quantity is exactly that many packages becomes one line per mark with a quantity of 1. A per-package weight is copied to each; a weight for the whole range becomes equal-share estimates; a weight that does not say which is left blank for the planner with a note. A range that does not match the quantity is left as it is.
- **Packages are not products.** `quantity` is the number of packages (boxes, crates, pallets). The number of products inside (`contentsQuantity`, e.g. `500 pcs`) is kept as reference only and never used for planning.
- **Names** combine the package type with the commodity (`Wooden case – Hydraulic press`), without repeating a type the description already names.
- **Units as in the document.** Sizes are kept in the document's own unit; when all lines agree, the review opens in that unit. The **Sizes shown in** control switches the display only; storage stays cm/kg.
- **Volume** is calculated from the sizes alone, whether or not a weight is known.
- **Document totals** the document states (packages, product quantity, net, gross, volume) are shown above the review as "The document states" and compared with what the lines add up to.
- **Estimated weights.** When some packages have no weight but the document gives a total gross weight, the review offers an equal share of what is left (the total less the weights other lines do give). It is only applied on the planner's click, says what it is based on, and warns when the packages differ in size. Shares are worked out in hundredths of a kg so they add back up to the total exactly; anything rounding cannot place is reported, never hidden. It is not offered when another line's weight is itself in doubt.
- **Estimates must be confirmed.** An estimated line can be imported, and the equipment suggestion may use it (marked **Provisional**). The weight stays marked `est. · confirm` in the Cargo grid. **Calculate** asks for confirmation of all estimated weights before a load plan is made; entering another weight also retires the estimate. Stored in `customFields.weightEstimate` (no migration).
- **Stacking is never assumed.** A line whose stacking the document does not state is planned as **not stackable** (nothing on top), shown as "Not stated" in the review and with a dashed amber outline on the No-stack box in the Cargo grid until the planner decides. Stored in `customFields.stacking = "not-stated"`. This also applies to spreadsheets with blank stacking columns. Earlier imports defaulted such lines to stackable; those lines are unchanged.
- **Warnings only for real doubts.** The reader is told not to report uncertainty for a field the document labels clearly; a fully labelled line shows no warnings.

### Limits and honest gaps

- PDFs: up to 10 MB and (default) 30 pages, judged from the file's structure. A longer PDF is refused with a message, not cut short. Splitting a PDF into page batches, and extracting text locally, would need a PDF library that is not installed, so **page batching is not implemented**.
- Images over 5 MB are shrunk in the browser first. Rotation and poor lighting are left to the model; unreadable parts are reported, not guessed.
- Pasted text: 30,000 characters. A reading returns at most 500 lines and says when more were left.
- Cancel stops waiting for an answer. A request already sent may finish on the server and cost a request.
- One reading runs at a time per person and content: a repeated click joins the one running.
- Multilingual reading is built for (descriptions, numbers, units, headers in several languages) but **its accuracy has not been measured** on representative documents.
- No live Claude call has been made during development; every AI path is tested with a stand-in client.

### Saving

- Complete, validated lines are saved as cargo, and the server checks every line again (size and weight above zero, a name or mark, project access in the planner's organization).
- **Drafts.** With **Add lines only**, a line that is not complete (a size with no unit, a weight whose meaning is open, a missing weight) can still be added to finish in the Cargo grid. It needs a name or mark and a quantity. What is settled is kept; what is not is saved as **0**, which the Cargo grid already shows as missing and which keeps the line out of equipment suggestions, the Calculate step and load plans (`plannableLines`). What the document said (the sizes as written with their missing unit, the weight as written) is stored as notes inside the line's existing JSON (`customFields.importNotes`; no schema change) and shown in the grid next to the name until the line is complete, then dropped. No value is invented to fill a gap. Equipment suggestions need every selected line complete, so they are not offered for a draft.
- The Calculate step now leaves out any incomplete line (it used to pass them all to the packer) and says how many were left out.
- **Append** adds the lines. **Replace** needs an explicit confirmation and runs removal and creation in one transaction, so a failure leaves the cargo as it was. Replacing also removes the old lines' places in any saved plan (they are deleted with the lines), so the plan is out of date and must be calculated again.
- Repeated lines (same mark, name, size and weight) and lines already in the project are pointed out, never removed. Several lines may share a SKU.
- Importing changes the cargo signature, so the existing plan shows as out of date through the usual plan-status mechanism; nothing is recalculated automatically. Equipment suggestions are computed from the cargo and follow it.
- The saved display unit is not changed by an import.

### Configuration

`ANTHROPIC_API_KEY` (server only), `COMPASS_AI_PROVIDER` (default `anthropic`), `COMPASS_AI_MODEL` (default `claude-sonnet-5-5`), `COMPASS_AI_TIMEOUT_MS`, `COMPASS_AI_MAX_PDF_PAGES`. Documented in `.env.example`. A provider other than `anthropic` reports "not available" until one is written against `src/lib/extraction-provider.ts`.

## Remaining capacity analysis

Shown on the Calculate step under the plan table, for a plan that matches the cargo (an out-of-date plan is not analysed). It works on the plan as it is shown, packed or hand-arranged, and **never moves, removes or re-packs** a planned piece.

- **Same engine.** Each unit is rebuilt with its pieces exactly where they are (`Unit.preload` in `packages/solver/src/unit.ts`), and anything new is tried with the packer's unchanged `tryPlace`: rotations allowed by the cargo line, inner size and ULD contour, collisions, the project's support share, stackability, floor-only, stack layers and load, payload and axle estimates. There is no second packing algorithm. Code: `packages/solver/src/capacity.ts`, adapter `src/lib/remaining-capacity.ts`, UI `src/components/remaining-capacity.tsx` and `additional-cargo-check.tsx`.
- **Three kinds of free volume.** *Theoretical*: inner volume less the cargo's own volume. *Usable loading space*: free space with something to stand on (the floor, or the top of stackable cargo) and at least 10 cm each way. *Restricted or unusable*: space above cargo that may not be stacked on, plus gaps too small or with nothing under them.
- **No double counting.** The packer keeps overlapping "maximal" free spaces. For reporting they are split into non-overlapping boxes (largest kept whole first), so volumes and floor areas add up. Packing simulations keep using the packer's original overlapping spaces, so no larger placement is lost by the split.
- **Uniform cargo** means every loaded piece (quantities counted, not lines) has the same placeable sizes, shape and stacking rules; a line that may be turned matches its turned copy. Then identical packages are added unit by unit until the packer refuses one, and the count, weight, volume, potential total and positions are shown, with the proposed pieces as dashed outlines in the top and side views. If the loaded pieces differ in weight, the heaviest is used. **The count is what the greedy packer found, not a proven maximum**; a fresh plan for the larger quantity could arrange the whole load differently.
- **Non-uniform cargo**: no package count; the usable empty spaces are listed with size, position (from the front-left corner of the floor) and what they stand on.
- **Why it stopped.** A physical limit is named when the packer reports it: available space, payload, stacking and support rules, axle limits, package size, segregation. The payload check comes first in the packer, so when payload is the factor, space may also have been short. The simulation's own bounds (2,000 pieces per unit, 1.5 s in the browser shared by the units) are reported separately as simulation limits, with "at least" before the count.
- **Integrity of the existing plan.** While rebuilding, every rule above is checked on the existing pieces (outside the unit, overlap, unsupported or too little support, standing on non-stackable cargo, floor-only, stack layers and load, segregation, payload, axles), plus the layout check the server runs on saved layouts (including allowed rotations). Any violation is listed and the results are marked **Not validated**. A heavier piece on a lighter one is only a note: the packer avoids it, but the Playground allows it in hand-arranged layouts.
- **Provisional.** When a cargo line in the plan still has an estimated weight, or a line is left out of the plan for missing its weight, the analysis is marked provisional. Stacking that is not stated is planned as not stackable: nothing is placed on it, and the analysis says so.
- **Add More Cargo.** A button in the Remaining capacity section opens the project's Cargo step, where cargo is added with the usual tools. Moving between steps does not change the plan; only a real cargo change makes it out of date.
- **Check additional cargo fit (not shown on the Calculate page).** The manual fit check was removed from the page after a team decision; its engine (`checkAdditionalFit`), adapter (`checkExtraCargo`, `cargoToAdd`, `isFitCurrent`) and component (`additional-cargo-check.tsx`) are kept, tested, for later use. As built: Length, width, height (in the planner's length unit), weight per piece, quantity (up to 500), orientation, stackable (off by default) and floor-only. It is tried around the plan, unit by unit, and nothing is saved. The result shows the quantity requested, the quantity that fits and the quantity that does not. **Add to cargo list** saves only the quantity that fits (hidden when none fit), only on the planner's click, and only while the result is current: changing any input, the plan, the cargo or the support share drops it. A provisional or unvalidated result must be acknowledged first. It goes through the existing `importCargoRows` action and cargo validation; the plan then shows as out of date (its cargo signature changes) until it is recalculated. The plan itself is never changed.
- **Limits.** Regions are boxes: in a contoured ULD they may reach into the cut corners (noted on the unit). Only the 300 largest free spaces of a unit become regions; on a very fragmented unit the rest are left out and the usable space may be slightly understated (noted as "only the largest free spaces were analysed"). Balance (centre of gravity) is reported as warnings the additions would add, not used as a block, as in the Playground. The analysis runs in the browser on the main thread; typical plans take milliseconds.

## Auth and database

Local demo organization id is `org_compass_demo`. Accounts, all with password `compass-demo`:

- `admin@compass.local` — admin
- `planner@compass.local` — planner
- `viewer@compass.local` — viewer

Change these before any shared deployment. Sessions are JWT credentials sessions. Roles are strings in SQLite (`ADMIN`, `PLANNER`, `VIEWER`) so the schema stays valid on Postgres, where they can become enums.

SQLite is the local database. JSON columns hold axle groups, rules, and plan metrics. Floats are used for dimensions and the relative cost figure.

## Floor utilization

Every unit shows **one** floor figure, Floor utilization. It comes from one shared function (`floorUtilization` in `packages/physics/src/footprint.ts`), so the Calculate table, the Load plan, the Playground, the Excel export, the printed report and the saved plan always report the same number for the same layout.

### Footprint convention

Whatever its shape, a piece occupies the rectangle `l × w` of its placed bounding box (the solver has always done this). A drum is therefore a square footprint, not a circle, and a pipe is its length by its diameter. The entered external dimensions are used as they are: packaging that is already inside them is not added again. All lengths are centimetres.

A piece counts as standing on the floor when its underside is within 0.5 cm of the floor (`FLOOR_CONTACT_TOLERANCE_CM`). Stacked or raised pieces do not occupy floor directly and are left out.

### Floor utilization (%)

```
floor % = area( union of [x, x + l] × [y, y + w] over floor pieces ) / (unit length × unit width) × 100
```

The union is exact (no grid, no rounding of positions or sizes) and counts overlapping footprints once. Before this was shared, the Playground measured on a 5 cm grid, which rounded every piece outward and made the same layout read differently on different screens (13.8% against 15.8% on one test layout). That grid is gone, and nothing returns to it.

### Plans saved by earlier versions

The floor figure of a saved plan is **worked out from its saved positions every time the plan is opened**, not read from a stored number. A plan from before the exact calculation therefore shows the exact figure, and a plan saved by a version that also kept an "effective" figure simply does not show it. The stored numbers stay in the database, unread.

Earlier versions of the app offered a handling allowance (free space around cargo). It was removed. Its settings can still sit in stored JSON: `Project.rules.clearanceCm`, a cargo line's `customFields.clearanceCm` / `clearanceSides`, a plan's `settings.clearanceCm` / `clearanceConfig`, and the `floorActualPct` / `floorEffectivePct` metrics. They are **ignored**: nothing reads them to calculate, show or check anything, no migration or cleanup has been run, and no data was deleted. Other keys in the same JSON are written back unchanged when a line, a layout or a project rule is saved, so saving never strips them either. They are harmless dormant data. A cleanup, if ever wanted, would be an optional one-off script run with approval.

A plan packed with an allowance keeps the positions it was saved with. It stays valid (pieces simply have extra space between them), is not marked out of date because of it, and is repacked only when the planner chooses Recalculate. A piece an earlier version left unloaded for its allowance (reason `CLEARANCE`) is still listed with the explanation it saved.

### Plan status

One status is shown everywhere (`src/lib/plan-status.ts`): the stepper, the Calculate page, the Load plan page, and the project list (which uses the same staleness rule).

| Status | When |
| --- | --- |
| Not calculated | There is no plan. |
| Calculating… | A calculation is running. |
| Plan ready | A plan exists and matches the project's cargo. |
| Out of date | A plan exists but the cargo changed since. |
| Calculation failed | The last calculation failed. A previous plan, if any, is still shown but is never reported as ready. |

A plan is out of date when the cargo facts that decide packing differ from its recorded **cargo signature** (`cargoSignature` in `Plan.settings`): lines added or removed, sizes, weights, quantities, orientation, allowed rotations, stacking and priority rules. Names, SKUs, colours and anything a line carries that is no longer used are not part of it. The signature function was not changed when the allowance was removed, so every signature saved before still matches the same cargo: removing the feature does not mark a single plan out of date. Plans saved before signatures fall back to edit times. `src/lib/plan-staleness.ts` is the one place this is decided.

### Hand-arranged layouts

A plan is **automatic** until the planner moves cargo in the Playground and saves; after that it is **hand-arranged** (`Plan.settings.layoutSource`, "MANUAL") and stays so. The Load plan says "Hand-arranged layout: it is not repacked automatically", and the Playground shows the same notice. Nothing repacks a plan by itself.

Recalculating packs the cargo again and replaces the layout, so it asks first whenever that would throw away the planner's work: with moves not yet saved ("Recalculate and discard your layout edits?"), and with a saved hand-arranged layout ("Recalculate and replace your hand-arranged layout?"). Cancel changes nothing. The rule is `recalculateGuard` in `src/lib/recalc-guard.ts`. The out-of-date banner says the layout will be replaced and that the planner is asked first.

### Rotation codes

A placed piece's rotation code says which of its entered axes lie along x, y and z (`LWH` as entered, `WLH` a quarter turn, other orders when tipped), and may end in `@180` for a half-turn facing. The packer now writes only the plain codes, but plans saved by earlier versions can hold `LWH@180` and `WLH@180`. They are still read, validated and shown (the Turned tag says "Turned 180°"), and the saved sizes and codes are never rewritten just to tidy them.

- Rotating a piece in the Playground swaps its length and width. A piece as entered flips between `LWH` and `WLH` as it always did. A piece saved with a half-turn facing keeps going round (`LWH@180` → `WLH@180` → `LWH` → `WLH`), so its code always agrees with its sizes. A tipped piece swaps the first two axes of its code.
- The facing never changes what a piece occupies, so it never affects floor use, collisions or support.
- A line with a fixed orientation keeps exactly the orientation it was entered in: the Playground refuses to turn it, and the server refuses a save in which it is turned or faces the other way, even when its footprint is square.
- The Excel packing list shows each piece's rotation code and, beside it, the facing in words.

### One minimum support share

The smallest share of a stacked piece that must rest on something is a **planning constraint, not a guarantee of physical stability**: an area ratio plus a check that the centre of gravity is over the support. It does not model friction, load shift, vibration or securing, and a layout that passes it is not thereby safe to ship.

There is one default, **75%** (`DEFAULT_MIN_SUPPORT_PCT`, the packer's own, stricter value), and one way of resolving it (`resolveMinSupportPct`): the project's own setting (`Project.rules.minSupportPct`, 50 to 100) when it has a valid one, otherwise 75%. The packer, the Playground's drop check, its keyboard moves, rotation and add-back, the free-spot search and the server's save check all use that resolved value. A project with no setting therefore gets 75% everywhere; a project with an explicit setting keeps it everywhere.

- The Playground starts from the project's value every time it opens; a number left in the browser from earlier is not used.
- A value sent by the browser with a layout save must be a number from 50 to 100 or the save is refused. It is the planner's explicit change to the project's setting: it is used for that save and stored, so afterwards the packer, the Playground and the server all use it. The default (75%) is never written to the project, so saving a layout alone never changes how the packer behaves. Other keys in the project's rules are kept. Only planners and admins can save.
- A stored value outside 50 to 100 is ignored (75% applies).
- Support is one rule among several: collisions, walls, stacking, floor-only and rotation checks are unchanged by it.
- Layouts saved earlier under the old 70% Playground/server default may be refused if a piece in them is moved, or something under them moves, and they have between 70% and 75% support. A piece already in that state that is not touched does not block a save.

### Metrics recalculated on every change

`computeUnitMetrics` (`packages/solver/src/unit-metrics.ts`) turns a list of placed pieces into every unit figure: weight, remaining payload, volume, remaining volume, floor utilization, centre of gravity, estimated axle loads and the used length, width and height. The solver, the Playground (`liveMetrics`) and the server all call it.

- In the Playground the figures are recomputed from the pieces on every accepted change: move, turn, set aside, add back, undo and reset. Nothing is cached, so undo and reset return exactly the earlier numbers, and the packing algorithm is never re-run on a hand-arranged layout.
- `savePlanLayout` does not trust the client. It checks the final layout with the same physics as the Playground (walls, collisions, support, stacking, floor-only pieces, allowed turns), recalculates every figure and stores positions, metrics and warnings together in one transaction. The Load plan table and header are updated from what the server returns, and a reload reads the stored positions.
- A piece that was already invalid in the plan being replaced (for example from an older version) does not block a save unless it is the piece being moved, or something moved away from under it.

### Packing is unchanged

Removing the allowance did not change how cargo is packed. `packages/solver/src/packing-equivalence.test.ts` pins nine representative jobs (uniform and mixed boxes, stacking rules, drums and pipes, overflow, an oversized piece, two equipment types, stops and priorities, a payload limit) to what the solver produced before the removal: the number of units, pieces packed and left out, each unit's floor utilization, and a fingerprint of every placement's position, size, rotation and loading order. A packing change that alters them must be deliberate and say why.

### Known limitations

- **Axle loads are a planning estimate, not a verified weighing and not a compliance check.** They use a simple beam model on cargo weight only: tare, tractor and fifth-wheel loads are not included, and with three or more axle groups the rear groups are assumed to share the load equally. They are shown as estimates and as warnings only. They must not be used to certify axle or gross weights.
- Payload and axle overloads are reported as warnings in the saved plan, not refused on save (the Playground can also be set to a non-strict mode).
- The server does not validate loading order, destination (stop) order, or the ULD contour shape of hand-moved pieces, which matches what the Playground checks.
- The loading sequence number is not stored in the database; after a reload it is the order the pieces are read back.
- The server checks a hand-edited layout; a freshly calculated plan from the solver is still stored as sent by the browser.
- Which plan is "hand-arranged" is recorded when a saved layout edit moved something; a plan edited before this was recorded is treated as automatic.
- Replacing cargo (importing with "replace") removes the old lines' places in a saved plan, because they are deleted with the lines; the plan then shows as out of date.
- Costs, payloads and axle limits remain planning defaults, not certified ratings.
