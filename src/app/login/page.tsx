import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SiteHeader } from "@/components/site-header"
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
    <>
      <SiteHeader user={null} />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {showDemo ? "Sign in with your account, or pick a demo account below." : "Sign in with your work email."}
        </p>
        <div className="mt-5">
          <LoginForm callbackUrl={callbackUrl} showDemo={showDemo} />
        </div>
      </main>
    </>
  )
}
