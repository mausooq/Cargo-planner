import { solve, type SolverInput } from "@compass/solver"

type Incoming = { type: "solve"; input: SolverInput }

self.onmessage = (event: MessageEvent<Incoming>) => {
  if (event.data.type !== "solve") return
  try {
    const result = solve(event.data.input, (progress) => {
      self.postMessage({ type: "progress", progress })
    })
    self.postMessage({ type: "done", result })
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "The solver failed.",
    })
  }
}
