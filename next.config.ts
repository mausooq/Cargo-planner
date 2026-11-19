import type { NextConfig } from "next"

/**
 * Hosts other than localhost that may open the dev server, for example a teammate on the same
 * Wi-Fi using this machine's IP. Next.js blocks dev scripts for any other host, which leaves pages
 * unresponsive (the login button does nothing). Add more, comma separated, with DEV_ORIGINS in .env
 * if this machine's IP changes, e.g. DEV_ORIGINS=10.1.12.204,192.168.1.20
 * Only affects `next dev`; production builds ignore it.
 */
const devOrigins = ["10.1.12.204", ...(process.env.DEV_ORIGINS ?? "").split(",")]
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  transpilePackages: ["@compass/domain", "@compass/physics", "@compass/solver"],
  allowedDevOrigins: [...new Set(devOrigins)],
}

export default nextConfig
