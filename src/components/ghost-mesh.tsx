"use client"

import { useEffect, useMemo } from "react"
import { BoxGeometry, EdgesGeometry, MeshBasicMaterial } from "three"
import { CylinderOutline } from "@/components/cylinder-outline"
import { PipeMesh, pipeInnerRadius } from "@/components/pipe-mesh"
import type { PlanItemView } from "@/lib/plan-view"

const SCALE = 0.01

export function GhostMesh({
  item,
  valid,
  validColor,
  invalidColor,
}: {
  item: PlanItemView
  valid: boolean
  validColor: string
  invalidColor: string
}) {
  const color = valid ? validColor : invalidColor
  const length = item.lengthCm * SCALE
  const width = item.widthCm * SCALE
  const height = item.heightCm * SCALE
  const drum = item.shape === "CYLINDER_DRUM"
  const pipe = item.shape === "PIPE"
  const alongLength = pipe && item.lengthCm >= item.widthCm
  const radius = drum
    ? Math.min(length, width) / 2
    : pipe
      ? alongLength
        ? Math.min(width, height) / 2
        : Math.min(length, height) / 2
      : 0
  const tube = pipe ? (alongLength ? length : width) : height
  const rotation: [number, number, number] = pipe ? (alongLength ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]) : [0, 0, 0]
  const ghostMaterial = useMemo(
    () => new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
    [color],
  )

  const edges = useMemo(() => {
    if (drum || pipe) return null
    const box = new BoxGeometry(length, height, width)
    const geometry = new EdgesGeometry(box)
    box.dispose()
    return geometry
  }, [drum, height, length, pipe, width])

  useEffect(
    () => () => {
      ghostMaterial.dispose()
      edges?.dispose()
    },
    [edges, ghostMaterial],
  )

  return (
    <group
      position={[
        (item.x + item.lengthCm / 2) * SCALE,
        (item.z + item.heightCm / 2) * SCALE + 0.004,
        (item.y + item.widthCm / 2) * SCALE,
      ]}
      renderOrder={20}
    >
      <group rotation={rotation}>
        {pipe ? (
          <PipeMesh radius={radius} length={tube} material={ghostMaterial} />
        ) : drum ? (
          <mesh material={ghostMaterial}>
            <cylinderGeometry args={[radius, radius, tube, 64]} />
          </mesh>
        ) : (
          <mesh material={ghostMaterial}>
            <boxGeometry args={[length, height, width]} />
          </mesh>
        )}
      </group>
      {drum || pipe ? (
        <CylinderOutline
          radius={radius}
          length={tube}
          rotation={rotation}
          innerRadius={pipe ? pipeInnerRadius(radius) : undefined}
          color={color}
        />
      ) : (
        <lineSegments geometry={edges ?? undefined} renderOrder={21}>
          <lineBasicMaterial color={color} toneMapped={false} />
        </lineSegments>
      )}
    </group>
  )
}
