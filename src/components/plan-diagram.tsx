import { cargoLabelColor } from "@/lib/format"
import type { PlanUnitView } from "@/lib/plan-view"

/**
 * Flat 2D drawing of one unit, for print and export. Pure SVG so it prints sharply
 * and needs no WebGL. Solver axes: x front → doors, y left → right, z floor → up.
 */
export function PlanDiagram({
  unit,
  view,
  className,
  bare = false,
  proposed = [],
}: {
  unit: PlanUnitView
  view: "top" | "side" | "front"
  className?: string
  /** Hide the Front / Doors captions (for small thumbnails). */
  bare?: boolean
  /** Pieces that are only proposed (not part of the plan), drawn as see-through dashed outlines. */
  proposed?: { x: number; y: number; z: number; lengthCm: number; widthCm: number; heightCm: number }[]
}) {
  const pad = bare ? 6 : 24
  // Horizontal extent: length for top and side, width when looking in from the doors.
  const width = view === "front" ? unit.widthCm : unit.lengthCm
  const depth = view === "top" ? unit.widthCm : unit.heightCm
  const viewWidth = width + pad * 2
  const viewHeight = depth + pad * 2
  const order = new Map(
    unit.items
      .slice()
      .sort((a, b) => a.sequence - b.sequence || a.x - b.x || a.z - b.z)
      .map((item, index) => [item.id, index + 1]),
  )
  // Paint far / low pieces first so nearer or higher ones sit on top.
  const items = unit.items
    .slice()
    .sort((a, b) =>
      view === "top" ? a.z + a.heightCm - (b.z + b.heightCm) : view === "side" ? a.y - b.y : a.x - b.x,
    )
  const font = Math.max(10, Math.min(28, Math.min(width, depth) / 14))

  // Pieces hidden behind each other in this view share one rectangle; list all their numbers on it.
  type Shape = { key: string; x: number; y: number; w: number; h: number; color: string; numbers: number[] }
  const shapes = new Map<string, Shape>()
  for (const item of items) {
    const x = pad + (view === "front" ? item.y : item.x)
    const w = view === "front" ? item.widthCm : item.lengthCm
    // SVG y grows downward: top view shows the left wall at the top, side view puts the floor at the bottom.
    const y = view === "top" ? pad + item.y : pad + (unit.heightCm - item.z - item.heightCm)
    const h = view === "top" ? item.widthCm : item.heightCm
    const key = [x, y, w, h].map((value) => Math.round(value)).join(":")
    const number = order.get(item.id) ?? 0
    const existing = shapes.get(key)
    if (existing) {
      existing.numbers.push(number)
      existing.color = item.color
      // Re-insert so this rectangle paints after anything drawn since it first appeared.
      shapes.delete(key)
      shapes.set(key, existing)
    } else {
      shapes.set(key, { key, x, y, w, h, color: item.color, numbers: [number] })
    }
  }

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      className={className}
      role="img"
      aria-label={`${view === "top" ? "Top" : view === "side" ? "Side" : "Doors"} view of ${unit.equipmentName}`}
    >
      <rect x={pad} y={pad} width={width} height={depth} fill="#f8fafc" stroke="#334155" strokeWidth={Math.max(1.5, width / 400)} />
      {[...shapes.values()].map((shape) => {
        const label = numberRange(shape.numbers)
        const showLabel = !bare && shape.w > font * (0.9 + label.length * 0.6) && shape.h > font * 1.2
        return (
          <g key={shape.key}>
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              fill={shape.color}
              fillOpacity={0.88}
              stroke="#0f172a"
              strokeWidth={Math.max(0.75, width / 900)}
            />
            {showLabel ? (
              <text
                x={shape.x + shape.w / 2}
                y={shape.y + shape.h / 2}
                fontSize={font}
                textAnchor="middle"
                dominantBaseline="central"
                fill={cargoLabelColor(shape.color)}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontWeight={600}
              >
                {label}
              </text>
            ) : null}
          </g>
        )
      })}
      {proposed.map((item, index) => (
        <rect
          key={`proposed-${index}`}
          x={pad + (view === "front" ? item.y : item.x)}
          y={view === "top" ? pad + item.y : pad + (unit.heightCm - item.z - item.heightCm)}
          width={view === "front" ? item.widthCm : item.lengthCm}
          height={view === "top" ? item.widthCm : item.heightCm}
          fill="#0ea5e9"
          fillOpacity={0.12}
          stroke="#0284c7"
          strokeWidth={Math.max(1, width / 500)}
          strokeDasharray={`${Math.max(4, width / 120)} ${Math.max(3, width / 200)}`}
          data-proposed=""
        />
      ))}
      {!bare && view !== "front" ? (
      <>
      <text x={pad} y={pad - 8} fontSize={font * 0.8} fill="#475569" fontFamily="ui-sans-serif, system-ui, sans-serif">
        Front
      </text>
      <text
        x={pad + width}
        y={pad - 8}
        fontSize={font * 0.8}
        fill="#475569"
        textAnchor="end"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Doors
      </text>
      </>
      ) : null}
    </svg>
  )
}

/** [1, 2, 3, 7] → "1–3, 7" */
export function numberRange(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (const value of [...sorted.slice(1), Number.NaN]) {
    if (start === undefined || previous === undefined) break
    if (value === previous + 1) {
      previous = value
      continue
    }
    parts.push(start === previous ? String(start) : `${start}–${previous}`)
    start = value
    previous = value
  }
  return parts.join(", ")
}
