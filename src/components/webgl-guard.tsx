"use client"

import { Component, useEffect, useState, type ReactNode } from "react"
import { Box, RotateCcw } from "lucide-react"

let cachedSupport: boolean | null = null

/**
 * True if the browser can create a WebGL context right now. Chrome and Edge switch WebGL off
 * ("GL_VENDOR = Disabled") after repeated GPU crashes, and some machines never have it.
 * The probe context is released straight away so it does not count toward the browser's limit.
 */
export function canUseWebGL(): boolean {
  if (cachedSupport !== null) return cachedSupport
  if (typeof document === "undefined") return true
  try {
    const canvas = document.createElement("canvas")
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null
    cachedSupport = Boolean(gl)
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
  } catch {
    cachedSupport = false
  }
  return cachedSupport
}

/** Forget the cached answer, e.g. before the user retries after a context loss. */
export function resetWebGLCheck() {
  cachedSupport = null
}

type BoundaryProps = { fallback: (retry: () => void) => ReactNode; children: ReactNode }

class ViewerErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // Keep a trace for debugging; the user sees the friendly fallback instead of a crashed page.
    console.warn("3D view failed and was replaced by the fallback:", error)
  }

  retry = () => {
    resetWebGLCheck()
    this.setState({ failed: false })
  }

  render() {
    if (this.state.failed) return this.props.fallback(this.retry)
    return this.props.children
  }
}

/**
 * Wraps a 3D view. If WebGL is unavailable, the view throws while starting, or the GPU drops the
 * context later, it shows `fallback` (for example a 2D drawing) plus a short note instead of
 * crashing the whole page.
 */
export function WebGLGuard({
  children,
  fallback,
  compact = false,
}: {
  children: (onContextLost: () => void) => ReactNode
  fallback?: ReactNode
  compact?: boolean
}) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [lost, setLost] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Checked after mount so server and browser render the same first HTML.
    const timer = window.setTimeout(() => setSupported(canUseWebGL()), 0)
    return () => window.clearTimeout(timer)
  }, [attempt])

  function retry() {
    resetWebGLCheck()
    setLost(false)
    setSupported(null)
    setAttempt((count) => count + 1)
  }

  const unavailable = (onRetry: () => void) => (
    <ViewerFallback compact={compact} onRetry={onRetry}>
      {fallback}
    </ViewerFallback>
  )

  if (supported === false || lost) return unavailable(retry)
  if (supported === null) return null
  return (
    <ViewerErrorBoundary key={attempt} fallback={(boundaryRetry) => unavailable(() => (boundaryRetry(), retry()))}>
      {children(() => setLost(true))}
    </ViewerErrorBoundary>
  )
}

function ViewerFallback({ compact, onRetry, children }: { compact: boolean; onRetry: () => void; children?: ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col bg-white text-neutral-700">
      {children ? <div className="min-h-0 flex-1 p-2">{children}</div> : null}
      {compact ? null : (
        <div
          role="status"
          className={
            children
              ? "absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              : "m-auto flex max-w-sm flex-col items-center gap-2 p-4 text-center text-sm"
          }
        >
          {children ? null : <Box className="size-6 text-neutral-400" aria-hidden="true" />}
          <span className="flex-1">
            3D view is not available because your browser has 3D graphics (WebGL) turned off. Fully close and reopen
            the browser to turn it back on.{children ? " Showing a flat drawing instead." : ""}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-current/30 px-2 py-1 font-medium hover:bg-white/60"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            Try 3D again
          </button>
        </div>
      )}
    </div>
  )
}
