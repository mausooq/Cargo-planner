import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { CompassMark } from "@/components/compass-mark"
import { LoginForm } from "@/app/login/login-form"
import { safeNextPath } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata = { title: "Sign in" }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>
}) {
  const session = await auth()
  const params = await searchParams
  const rawCallback = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl
  const callbackUrl = safeNextPath(rawCallback)
  if (session?.user) redirect(callbackUrl)
  // Demo accounts and their shared password are for local use only. Set COMPASS_DEMO_LOGIN=1 to show them elsewhere.
  const showDemo = process.env.NODE_ENV !== "production" || process.env.COMPASS_DEMO_LOGIN === "1"

  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel: desktop only. */}
      <section className="relative hidden overflow-hidden bg-[#0c4a3e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, rgb(61 143 122 / 0.9), transparent 45%), radial-gradient(circle at 85% 85%, rgb(15 92 76 / 0.9), transparent 50%)",
          }}
        />
        <CompassMark className="absolute -right-24 -bottom-24 size-[28rem] text-white/[0.06]" />
        <div className="relative flex items-center gap-3 text-lg font-semibold">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15">
            <CompassMark className="size-6" />
          </span>
          Compass
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">Load planning without the guesswork.</h2>
          <ul className="mt-8 space-y-4 text-[15px] text-white/85">
            {[
              ["Import your packing list", "Excel or CSV, mapped in a few clicks."],
              ["Get the best-fit equipment", "Compass test-packs every container, ULD, and truck."],
              ["See it in 3D, then print", "Adjust by hand, check weight and balance, hand over the plan."],
            ].map(([title, text]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
                <span>
                  <span className="block font-medium text-white">{title}</span>
                  <span className="text-white/70">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Sea containers · Road trailers · Air ULDs · Pallets</p>
      </section>

      <section className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-lg font-semibold lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CompassMark className="size-5" />
            </span>
            Compass
          </div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {showDemo ? "Sign in with your account, or pick a demo account below." : "Sign in with your work email."}
          </p>
          <div className="mt-6">
            <LoginForm callbackUrl={callbackUrl} showDemo={showDemo} />
          </div>
        </div>
      </section>
    </main>
  )
}
