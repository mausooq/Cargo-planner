import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@compass/domain": path.resolve(__dirname, "packages/domain/src/index.ts"),
      "@compass/solver": path.resolve(__dirname, "packages/solver/src/index.ts"),
      "@compass/physics": path.resolve(__dirname, "packages/physics/src/index.ts"),
    },
  },
})
