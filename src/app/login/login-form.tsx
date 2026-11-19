"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { loginSchema, roleLabel, type LoginInput } from "@compass/domain"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { loginAction } from "@/app/actions/login"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo-accounts"

export function LoginForm({ callbackUrl, showDemo }: { callbackUrl: string; showDemo: boolean }) {
  const [pendingDemo, setPendingDemo] = useState<string | null>(null)
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  async function onSubmit(values: LoginInput) {
    const result = await loginAction({ ...values, callbackUrl })
    if (result?.error) {
      form.setError("root", { message: result.error })
      toast.error(result.error)
    }
  }

  async function signInAs(email: string) {
    setPendingDemo(email)
    form.setValue("email", email)
    form.setValue("password", DEMO_PASSWORD)
    const result = await loginAction({ email, password: DEMO_PASSWORD, callbackUrl })
    if (result?.error) {
      form.setError("root", { message: result.error })
      toast.error(result.error)
      setPendingDemo(null)
    }
  }

  const rootError = form.formState.errors.root?.message

  return (
    <div className="rounded-md border bg-card p-4">
      {/* method="post": if scripts fail to load, a plain submit must never put the password in the URL. */}
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" autoFocus {...form.register("email")} />
          {form.formState.errors.email ? (
            <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
          {form.formState.errors.password ? (
            <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          ) : null}
        </div>
        {rootError ? <p className="text-sm text-destructive">{rootError}</p> : null}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {showDemo ? (
        <div className="mt-6 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Local demo password: <span className="font-mono text-foreground">{DEMO_PASSWORD}</span>
          </p>
          <ul className="mt-3 space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => signInAs(account.email)}
                  disabled={pendingDemo !== null}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <span>
                    <span className="block font-medium">{roleLabel(account.role)}</span>
                    <span className="text-muted-foreground">{account.email}</span>
                  </span>
                  <span>{pendingDemo === account.email ? "Signing in…" : "Use"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
