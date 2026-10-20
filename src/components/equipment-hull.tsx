"use client"

import { Edges, Line } from "@react-three/drei"
import { useEffect, useMemo } from "react"
import { DoubleSide, ExtrudeGeometry, Shape } from "three"
import { hasUldSide, type UldContour } from "@/lib/uld-contour"

export function AirPalletMesh({
  name,
  length,
  width,
  height,
}: {
  name: string
  length: number
  width: number
  height: number
}) {
  const winged = name.toLowerCase().includes("winged")
  const wing = winged ? 0.5 : 0
  const deck = 0.02
  return (
    <group>
      <mesh position={[length / 2, deck / 2, width / 2]}>
        <boxGeometry args={[length, deck, width]} />
        <meshBasicMaterial color="#2a2f35" toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[length / 2, deck + 0.002, width / 2]}>
        <planeGeometry args={[length, width]} />
        <meshBasicMaterial color="#2a2f35" toneMapped={false} />
      </mesh>
      {winged ? (
        <>
          <mesh position={[length / 2, deck / 2, -wing / 2]}>
            <boxGeometry args={[length * 0.55, deck, wing]} />
            <meshBasicMaterial color="#23282d" toneMapped={false} />
          </mesh>
          <mesh position={[length / 2, deck / 2, width + wing / 2]}>
            <boxGeometry args={[length * 0.55, deck, wing]} />
            <meshBasicMaterial color="#23282d" toneMapped={false} />
          </mesh>
        </>
      ) : null}
      <DashedEnvelope length={length} width={width} height={height} />
    </group>
  )
}

export function AirContourMesh({
  length,
  width,
  height,
  contour,
}: {
  length: number
  width: number
  height: number
  contour: UldContour | null
}) {
  const geometry = useMemo(() => {
    const topHouse = hasUldSide(contour?.topLeft) || hasUldSide(contour?.topRight)
    const shape = new Shape()

    if (topHouse) {
      const leftL = (contour?.topLeft.lengthMm ?? 0) / 1000
      const leftH = (contour?.topLeft.heightMm ?? 0) / 1000
      const rightL = (contour?.topRight.lengthMm ?? 0) / 1000
      const rightH = (contour?.topRight.heightMm ?? 0) / 1000
      shape.moveTo(0, 0)
      if (leftL > 0 && leftH > 0) {
        shape.lineTo(0, height - leftH)
        shape.lineTo(leftL, height)
      } else {
        shape.lineTo(0, height)
      }
      if (rightL > 0 && rightH > 0) {
        shape.lineTo(length - rightL, height)
        shape.lineTo(length, height - rightH)
      } else {
        shape.lineTo(length, height)
      }
      shape.lineTo(length, 0)
      shape.closePath()
      const next = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 })
      next.computeVertexNormals()
      return next
    }

    const left = contour?.bottomLeft ?? { lengthMm: 0, heightMm: 0 }
    const right = contour?.bottomRight ?? { lengthMm: 0, heightMm: 0 }
    const leftW = left.lengthMm / 1000
    const leftH = left.heightMm / 1000
    const rightW = right.lengthMm / 1000
    const rightH = right.heightMm / 1000

    if (leftW > 0 && leftH > 0) {
      shape.moveTo(leftW, 0)
      shape.lineTo(0, leftH)
    } else {
      shape.moveTo(0, 0)
    }
    shape.lineTo(0, height)
    shape.lineTo(width, height)
    if (rightW > 0 && rightH > 0) {
      shape.lineTo(width, rightH)
      shape.lineTo(width - rightW, 0)
    } else {
      shape.lineTo(width, 0)
    }
    shape.closePath()

    const next = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1 })
    next.rotateY(Math.PI / 2)
    next.translate(0, 0, width)
    next.computeVertexNormals()
    return next
  }, [contour, height, length, width])

  useEffect(() => () => geometry.dispose(), [geometry])

  const leftW = (contour?.bottomLeft.lengthMm ?? 0) / 1000
  const rightW = (contour?.bottomRight.lengthMm ?? 0) / 1000
  const floorWidth = Math.max(width - leftW - rightW, 0.02)
  const floorZ = rightW + floorWidth / 2

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#d7dde2"
          transparent
          opacity={0.14}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
        <Edges color="#4b5563" threshold={12} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[length / 2, 0.003, floorZ]}>
        <planeGeometry args={[length, floorWidth]} />
        <meshBasicMaterial color="#2a2f35" toneMapped={false} />
      </mesh>
    </group>
  )
}

function DashedEnvelope({ length, width, height }: { length: number; width: number; height: number }) {
  const corners: [number, number, number][] = [
    [0, 0, 0],
    [length, 0, 0],
    [length, 0, width],
    [0, 0, width],
    [0, height, 0],
    [length, height, 0],
    [length, height, width],
    [0, height, width],
  ]
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  return (
    <group>
      {edges.map(([a, b]) => {
        const start = corners[a]
        const end = corners[b]
        if (!start || !end) return null
        return (
          <Line
            key={`${a}-${b}`}
            points={[start, end]}
            color="#7d878e"
            dashed
            dashSize={0.08}
            gapSize={0.05}
            lineWidth={1}
          />
        )
      })}
    </group>
  )
}
