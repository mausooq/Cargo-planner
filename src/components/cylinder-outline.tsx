"use client"

import { Line } from "@react-three/drei"

const SEGMENTS = 48
const PAD = 0.003

export function CylinderOutline({
  radius,
  length,
  rotation,
  innerRadius,
  color = "#1a1a1a",
}: {
  radius: number
  length: number
  rotation: [number, number, number]
  innerRadius?: number
  color?: string
}) {
  const rim = radius + PAD
  const half = length / 2
  const top = circlePoints(rim, half)
  const bottom = circlePoints(rim, -half)
  const innerTop = innerRadius != null ? circlePoints(innerRadius, half) : null
  const innerBottom = innerRadius != null ? circlePoints(innerRadius, -half) : null

  return (
    <group rotation={rotation}>
      <Line points={top} color={color} lineWidth={1.5} toneMapped={false} />
      <Line points={bottom} color={color} lineWidth={1.5} toneMapped={false} />
      {innerTop ? <Line points={innerTop} color={color} lineWidth={1.25} toneMapped={false} /> : null}
      {innerBottom ? <Line points={innerBottom} color={color} lineWidth={1.25} toneMapped={false} /> : null}
    </group>
  )
}

function circlePoints(radius: number, y: number): [number, number, number][] {
  return Array.from({ length: SEGMENTS + 1 }, (_, index) => {
    const angle = (index / SEGMENTS) * Math.PI * 2
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius]
  })
}
