import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { CARGO_TEMPLATE_HEADERS, CARGO_TEMPLATE_ROWS } from "@/lib/cargo-import"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 })
  }

  const format = new URL(request.url).searchParams.get("format")
  const sheet = XLSX.utils.aoa_to_sheet([[...CARGO_TEMPLATE_HEADERS], ...CARGO_TEMPLATE_ROWS.map((row) => [...row])])
  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="compass-cargo-template.csv"',
      },
    })
  }

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "Cargo")
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="compass-cargo-template.xlsx"',
    },
  })
}
