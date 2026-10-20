"use client"

import { Button } from "@/components/ui/button"

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-lg px-4 py-16">
      <h1 className="text-xl font-semibold">This page did not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">Try again. If it keeps failing, check that the database is seeded.</p>
      <Button type="button" className="mt-4" size="sm" onClick={() => reset()}>
        Try again
      </Button>
    </main>
  )
}
