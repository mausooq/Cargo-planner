import { describe, expect, it } from "vitest"
import { cn } from "@/lib/utils"

describe("cn with the redesign type scale", () => {
  it("keeps a text colour next to a type-scale size", () => {
    expect(cn("text-primary-foreground", "text-button")).toBe("text-primary-foreground text-button")
    expect(cn("text-step", "text-muted-foreground")).toBe("text-step text-muted-foreground")
  })

  it("still lets a later size replace an earlier one", () => {
    expect(cn("text-sm", "text-button")).toBe("text-button")
    expect(cn("text-meta", "text-detail")).toBe("text-detail")
  })
})
