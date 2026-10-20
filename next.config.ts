import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@compass/domain", "@compass/physics", "@compass/solver"],
}

export default nextConfig
