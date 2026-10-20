"use client"

import { useEffect, useMemo } from "react"
import { BackSide, type Material } from "three"

const SEGMENTS = 64

export function pipeInnerRadius(radius: number) {
  return Math.max(radius * 0.5, radius - Math.max(0.012, radius * 0.26))
}

export function PipeMesh({
  radius,
  length,
  material,
}: {
  radius: number
  length: number
  material: Material
}) {
  const inner = pipeInnerRadius(radius)
  const half = length / 2
  const innerMaterial = useMemo(() => {
    const next = material.clone()
    next.side = BackSide
    return next
  }, [material])

  useEffect(() => () => innerMaterial.dispose(), [innerMaterial])

  return (
    <>
      <mesh material={material}>
        <cylinderGeometry args={[radius, radius, length, SEGMENTS, 1, true]} />
      </mesh>
      <mesh material={innerMaterial}>
        <cylinderGeometry args={[inner, inner, length, SEGMENTS, 1, true]} />
      </mesh>
      <mesh material={material} position={[0, half, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, radius, SEGMENTS]} />
      </mesh>
      <mesh material={material} position={[0, -half, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, radius, SEGMENTS]} />
      </mesh>
    </>
  )
}
