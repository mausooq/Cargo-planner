# Drag validation

While a piece is dragged in the 3D playground, a ghost shows the **settled** pose. The drop is accepted only when that ghost is valid (green, or blue in the colour-blind palette).

## Reason codes

| Code | When | Drop |
| --- | --- | --- |
| `OK` | Inside the inner box, no overlap, enough support, stacking and weight rules pass | Accepted |
| `OUTSIDE_CONTAINER` | Any extreme of the real volume is outside `0..L`, `0..W`, `0..H` (0.1 cm tolerance), or it hits an obstruction | Always rejected |
| `COLLISION` | Overlap with another piece deeper than 0.1 cm | Always rejected |
| `NO_SUPPORT` | Stacked and supported area is below the minimum % | Rejected in strict mode |
| `UNSTABLE` | Centre of gravity is outside the support polygon | Rejected in strict mode |
| `OVERLOAD_BELOW` | Piece below cannot carry this mass | Soft mode may warn |
| `NOT_STACKABLE` | Target piece forbids stacking | Soft mode may warn |
| `ORIENTATION_NOT_ALLOWED` | Rotation is not in the allowed set | Rejected |
| `WEIGHT_LIMIT` | Payload (or axle) limit exceeded | Soft mode may warn |
| `RULE_VIOLATION` | Segregation or a custom rule | Soft mode may warn |

`OUTSIDE_CONTAINER` and `COLLISION` are never accepted, even in soft mode.

## Inside-container test

- Boxes: every rotated corner must lie in the inner box.
- Standing drums: the **circle** (`radius = min(L, W) / 2`) must lie in the floor rectangle. The stored square AABB is ignored when it is larger than the circle, so a drum can sit on the side wall.
- Pipes: the circular cross-section is used (`radius = min` of the two short sides). A pipe stored as 300 × 40 × 20 can still touch the wall with its 20 cm diameter.
- Slide-along-walls (`clampToWalls`, default off) moves the ghost back inside and keeps it green. When the pointer is **outside the container footprint**, the ghost follows the pointer and stays red.

## Drop behaviour

- Green / blue release: undoable commit, 120 ms ease-out to the settled pose.
- Red / orange release or Escape: piece returns to the last valid pose (or the unloaded list). Nothing is written to undo history. A toast shows the reason.
- Keyboard nudge and `R` run the same checks. An invalid action is blocked and the ghost flashes red for 300 ms.

## Settings

- **Strict drops** (default): invalid reasons reject the drop.
- **Slide along walls**: clamp to the inner box while the pointer stays over the footprint.
- **Min support %** (default 70).
- **Blue / orange palette**: colour-blind alternative. The tooltip always includes a check or cross plus the text reason.
