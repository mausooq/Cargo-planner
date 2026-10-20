"use client"

import { Edges, OrbitControls } from "@react-three/drei"
import { Canvas, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import type { EquipmentListItem } from "@/lib/equipment-catalog"

const SCALE = 0.01
const COMPARE_COLORS = ["#9a3412", "#1e3a8a", "#3f6212", "#581c87"] as const

export function EquipmentCompareCanvas({ items }: { items: EquipmentListItem[] }) {
  const webgl = useMemo(() => {
    try {
      const canvas = document.createElement("canvas")
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
    } catch {
      return false
    }
  }, [])
  const reach = Math.max(...items.map((item) => Math.max(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm) * SCALE), 1)

  if (!webgl) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground" role="status">
        This browser cannot show the overlaid outlines. The spec table still lists every unit.
      </div>
    )
  }

  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [reach * 1.2, reach * 0.8, reach * 1.2], fov: 38 }} gl={{ antialias: true }}>
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={1.2} />
      {items.map((item, index) => (
        <OutlineBox
          key={item.id}
          length={item.innerLengthCm * SCALE}
          width={item.innerWidthCm * SCALE}
          height={Math.max(item.innerHeightCm * SCALE, 0.08)}
          color={COMPARE_COLORS[index] ?? COMPARE_COLORS[0]}
        />
      ))}
      <DemandFrame token={items.map((item) => item.id).join(",")} />
      <CompareControls reach={reach} />
    </Canvas>
  )
}

function OutlineBox({ length, width, height, color }: { length: number; width: number; height: number; color: string }) {
  return (
    <mesh position={[length / 2, height / 2, width / 2]}>
      <boxGeometry args={[length, height, width]} />
      <meshBasicMaterial color={color} transparent opacity={0.08} depthWrite={false} />
      <Edges color={color} />
    </mesh>
  )
}

function CompareControls({ reach }: { reach: number }) {
  const invalidate = useThree((state) => state.invalidate)
  return <OrbitControls makeDefault enablePan enableZoom target={[0, reach * 0.2, 0]} onChange={() => invalidate()} />
}

function DemandFrame({ token }: { token: string }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    invalidate()
  }, [invalidate, token])
  return null
}
