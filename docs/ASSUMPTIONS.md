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

Cargo is stored in centimetres and kilograms. Import accepts:

- Length: cm, mm (`÷ 10`), or inches (`× 2.54`)
- Weight: kg, or pounds (`× 0.45359237`)

Converted values are rounded to 4 decimal places so binary fractions do not leak into the database. The cargo grid itself always edits centimetres and kilograms.

## Auth and database

Local demo organization id is `org_compass_demo`. Accounts, all with password `compass-demo`:

- `admin@compass.local` — admin
- `planner@compass.local` — planner
- `viewer@compass.local` — viewer

Change these before any shared deployment. Sessions are JWT credentials sessions. Roles are strings in SQLite (`ADMIN`, `PLANNER`, `VIEWER`) so the schema stays valid on Postgres, where they can become enums.

SQLite is the local database. JSON columns hold axle groups, rules, and plan metrics. Floats are used for dimensions and the relative cost figure.
