"use client"

import { Billboard, Line, Text } from "@react-three/drei"
import { formatLengthIn, type LengthUnit } from "@/lib/cargo-units"
import { DIMENSION_COLORS } from "@/lib/format"
import type { UldContour } from "@/lib/uld-contour"

export function DimensionMarks({
  length,
  width,
  height,
  lengthCm,
  widthCm,
  heightCm,
  baseY = 0,
  showHeight = true,
  volumeM3,
  contour,
  unit = "cm",
}: {
  length: number
  width: number
  height: number
  lengthCm: number
  widthCm: number
  heightCm: number
  baseY?: number
  showHeight?: boolean
  volumeM3?: number
  contour?: UldContour | null
  /** The length unit labels are written in. Sizes are stored and drawn in centimetres whatever this is. */
  unit?: LengthUnit
}) {
  const fmt = (cm: number) => (unit === "cm" ? roundCm(cm) : formatLengthIn(cm, unit))
  const offset = Math.max(0.12, Math.min(length, width, height) * 0.08)
  const tick = Math.max(0.04, offset * 0.22)
  const font = Math.min(0.16, Math.max(0.075, Math.min(length, width) * 0.028))
  const volume = (volumeM3 ?? (lengthCm * widthCm * heightCm) / 1_000_000).toFixed(1)
  const y = baseY
  const rightW = (contour?.bottomRight.lengthMm ?? 0) / 1000
  const rightH = (contour?.bottomRight.heightMm ?? 0) / 1000
  const leftW = (contour?.bottomLeft.lengthMm ?? 0) / 1000
  const leftH = (contour?.bottomLeft.heightMm ?? 0) / 1000
  const topLeftL = (contour?.topLeft.lengthMm ?? 0) / 1000
  const topLeftH = (contour?.topLeft.heightMm ?? 0) / 1000
  const topRightL = (contour?.topRight.lengthMm ?? 0) / 1000
  const topRightH = (contour?.topRight.heightMm ?? 0) / 1000
  const heightX = topRightL > 0 ? length - topRightL : length

  return (
    <group>
      <AxisMeasure
        start={[0, y, width]}
        end={[length, y, width]}
        outward={[0, 0, offset]}
        tick={tick}
        label={`Length = ${fmt(lengthCm)}`}
        color={DIMENSION_COLORS.length}
        fontSize={font}
      />
      <AxisMeasure
        start={[0, y, 0]}
        end={[0, y, width]}
        outward={[-offset, 0, 0]}
        tick={tick}
        label={`Width = ${fmt(widthCm)}`}
        color={DIMENSION_COLORS.width}
        fontSize={font}
      />
      {showHeight ? (
        <AxisMeasure
          start={[heightX, y, width]}
          end={[heightX, y + height, width]}
          outward={[offset, 0, 0]}
          tick={tick}
          label={`Height = ${fmt(heightCm)}`}
          color={DIMENSION_COLORS.height}
          fontSize={font}
        />
      ) : null}
      {rightW > 0 ? (
        <AxisMeasure
          start={[0, y, 0]}
          end={[0, y, rightW]}
          outward={[-offset * 0.35, 0, 0]}
          tick={tick}
          label={fmt((contour?.bottomRight.lengthMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {rightH > 0 ? (
        <AxisMeasure
          start={[0, y, 0]}
          end={[0, y + rightH, 0]}
          outward={[0, 0, -offset * 0.45]}
          tick={tick}
          label={fmt((contour?.bottomRight.heightMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {rightW > 0 && rightH > 0 ? (
        <Line points={[[0, y, rightW], [0, y + rightH, 0]]} color="#0f5c4c" lineWidth={1.5} />
      ) : null}
      {leftW > 0 ? (
        <AxisMeasure
          start={[0, y, width - leftW]}
          end={[0, y, width]}
          outward={[-offset * 0.35, 0, 0]}
          tick={tick}
          label={fmt((contour?.bottomLeft.lengthMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {leftH > 0 ? (
        <AxisMeasure
          start={[0, y, width]}
          end={[0, y + leftH, width]}
          outward={[0, 0, offset * 0.45]}
          tick={tick}
          label={fmt((contour?.bottomLeft.heightMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {topLeftL > 0 ? (
        <AxisMeasure
          start={[0, y + height, width]}
          end={[topLeftL, y + height, width]}
          outward={[0, offset * 0.35, 0]}
          tick={tick}
          label={fmt((contour?.topLeft.lengthMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {topLeftH > 0 ? (
        <AxisMeasure
          start={[0, y + height - topLeftH, width]}
          end={[0, y + height, width]}
          outward={[-offset * 0.45, 0, 0]}
          tick={tick}
          label={fmt((contour?.topLeft.heightMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {topLeftL > 0 && topLeftH > 0 ? (
        <Line points={[[0, y + height - topLeftH, width], [topLeftL, y + height, width]]} color="#0f5c4c" lineWidth={1.5} />
      ) : null}
      {topRightL > 0 ? (
        <AxisMeasure
          start={[length - topRightL, y + height, width]}
          end={[length, y + height, width]}
          outward={[0, offset * 0.35, 0]}
          tick={tick}
          label={fmt((contour?.topRight.lengthMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {topRightH > 0 ? (
        <AxisMeasure
          start={[length, y + height - topRightH, width]}
          end={[length, y + height, width]}
          outward={[offset * 0.45, 0, 0]}
          tick={tick}
          label={fmt((contour?.topRight.heightMm ?? 0) / 10)}
          color="#0f5c4c"
          fontSize={font * 0.9}
        />
      ) : null}
      {topRightL > 0 && topRightH > 0 ? (
        <Line
          points={[[length - topRightL, y + height, width], [length, y + height - topRightH, width]]}
          color="#0f5c4c"
          lineWidth={1.5}
        />
      ) : null}
      <Billboard position={[length / 2, y + height + offset * 0.35, width / 2]}>
        <Text fontSize={font * 1.15} color="#0f5c4c" anchorX="center" anchorY="bottom">
          {`${volume} m³`}
        </Text>
      </Billboard>
    </group>
  )
}

function AxisMeasure({
  start,
  end,
  outward,
  tick,
  label,
  color,
  fontSize,
  alongFloor = false,
}: {
  start: [number, number, number]
  end: [number, number, number]
  outward: [number, number, number]
  tick: number
  label: string
  color: string
  fontSize: number
  alongFloor?: boolean
}) {
  const a: [number, number, number] = [start[0] + outward[0], start[1] + outward[1], start[2] + outward[2]]
  const b: [number, number, number] = [end[0] + outward[0], end[1] + outward[1], end[2] + outward[2]]
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const cap: [number, number, number] = alongFloor ? [0, tick, 0] : scaleTo(outward, tick)

  return (
    <group>
      {!alongFloor ? <Line points={[start, a]} color={color} lineWidth={1} /> : null}
      {!alongFloor ? <Line points={[end, b]} color={color} lineWidth={1} /> : null}
      <Line points={[a, b]} color={color} lineWidth={1.5} />
      <Line
        points={[
          [a[0] - cap[0], a[1] - cap[1], a[2] - cap[2]],
          [a[0] + cap[0], a[1] + cap[1], a[2] + cap[2]],
        ]}
        color={color}
        lineWidth={1.5}
      />
      <Line
        points={[
          [b[0] - cap[0], b[1] - cap[1], b[2] - cap[2]],
          [b[0] + cap[0], b[1] + cap[1], b[2] + cap[2]],
        ]}
        color={color}
        lineWidth={1.5}
      />
      <Billboard position={mid}>
        <Text fontSize={fontSize} color={color} anchorX="center" anchorY="bottom">
          {label}
        </Text>
      </Billboard>
    </group>
  )
}

function scaleTo(vector: [number, number, number], length: number): [number, number, number] {
  const hyp = Math.hypot(vector[0], vector[1], vector[2])
  if (hyp < 1e-6) return [0, length, 0]
  return [(vector[0] / hyp) * length, (vector[1] / hyp) * length, (vector[2] / hyp) * length]
}

function roundCm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
