import { solve, type SolverInput, type SolverProgress, type SolverResult } from "@compass/solver"

export async function runSolver(
  input: SolverInput,
  onProgress?: (progress: SolverProgress) => void,
): Promise<SolverResult> {
  if (typeof Worker === "undefined") return solve(input, onProgress)

  try {
    const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" })
    return await new Promise<SolverResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        worker.terminate()
        reject(new Error("The solver timed out."))
      }, (input.settings?.timeLimitMs ?? 5000) + 4000)

      worker.onmessage = (event: MessageEvent<{ type: string; result?: SolverResult; progress?: SolverProgress; message?: string }>) => {
        if (event.data.type === "progress" && event.data.progress) {
          onProgress?.(event.data.progress)
          return
        }
        if (event.data.type === "done" && event.data.result) {
          window.clearTimeout(timer)
          worker.terminate()
          resolve(event.data.result)
          return
        }
        if (event.data.type === "error") {
          window.clearTimeout(timer)
          worker.terminate()
          reject(new Error(event.data.message ?? "The solver failed."))
        }
      }
      worker.onerror = () => {
        window.clearTimeout(timer)
        worker.terminate()
        reject(new Error("The solver worker could not start."))
      }
      worker.postMessage({ type: "solve", input })
    })
  } catch {
    return solve(input, onProgress)
  }
}
