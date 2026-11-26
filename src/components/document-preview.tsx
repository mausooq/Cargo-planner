"use client"

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileImage, FileSpreadsheet, FileText, Maximize2, Minimize2, Minus, PanelLeftClose, Plus } from "lucide-react"
import { FOCUS_RING } from "@/components/design-system"
import type { ReviewLine } from "@/lib/import-review"
import { sourceTarget } from "@/lib/import-edit"
import { cn } from "@/lib/utils"

/** The original document an import was read from, while the import is open (an object URL, pasted text or sheet rows). */
export type SourceView =
  | { kind: "image"; url: string; name: string }
  | { kind: "pdf"; url: string; name: string }
  | { kind: "text"; text: string }
  | { kind: "sheet"; name: string; headers: string[] | null; rows: { rowNumber: number; cells: string[] }[]; truncated: boolean }

export function sourceName(source: SourceView): string {
  return source.kind === "text" ? "Pasted text" : source.name
}

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3]
const WIDTH_KEY = "compass.preview.width"
const MIN_WIDTH = 300
const MAX_WIDTH = 960

function storedWidth(): number {
  if (typeof window === "undefined") return 460
  const value = Number(window.localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : 460
}

/** Where the selected line came from in the document: a page (PDF), a row (sheet) or a quote (text). */
function targetOf(line: ReviewLine | null) {
  const target = line ? sourceTarget(line.source) : { kind: "none" as const }
  return {
    page: target.kind === "page" ? target.page : 1,
    row: target.kind === "row" ? target.row : undefined,
    quote: target.kind === "quote" || line?.source.quote ? line?.source.quote : undefined,
  }
}

/**
 * The original document beside the review table: collapsible, resizable (drag the right edge), with zoom,
 * fullscreen and page navigation. Selecting a line jumps to its page, row or quote. Nothing here is stored;
 * it shows the file the import is reading, for as long as the import is open.
 */
export function DocumentPreview({ source, line, onClose, className }: { source: SourceView; line: ReviewLine | null; onClose: () => void; className?: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const [zoomIndex, setZoomIndex] = useState(ZOOMS.indexOf(1))
  const [width, setWidth] = useState(storedWidth)
  const [fullscreen, setFullscreen] = useState(false)
  const target = targetOf(line)
  // A page the planner picked stands until another line points elsewhere.
  const [picked, setPicked] = useState<{ forPage: number; page: number } | null>(null)
  const page = picked && picked.forPage === target.page ? picked.page : target.page
  const zoom = ZOOMS[zoomIndex]!
  const paged = source.kind === "pdf"

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frame.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void frame.current?.requestFullscreen?.()
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    const start = event.clientX
    const from = width
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (next: globalThis.PointerEvent) => setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, from + next.clientX - start)))
    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      setWidth((current) => {
        window.localStorage.setItem(WIDTH_KEY, String(current))
        return current
      })
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
  }

  const KindIcon = source.kind === "sheet" ? FileSpreadsheet : source.kind === "text" ? FileText : FileImage
  const toolButton = cn("press flex size-8 items-center justify-center rounded-lg text-primary-foreground/90 hover:bg-white/15 disabled:opacity-40", FOCUS_RING)

  return (
    <aside
      ref={frame}
      aria-label="Original document"
      style={{ "--preview-w": `${width}px` } as CSSProperties}
      className={cn(
        "surface-card relative flex w-full shrink-0 flex-col overflow-hidden lg:sticky lg:top-4 lg:w-[var(--preview-w)]",
        fullscreen ? "h-screen w-screen rounded-none" : "h-[70vh] lg:h-[calc(100dvh-7rem)]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint-mint text-tint-mint-foreground">
          <KindIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5 font-bold">Original document</p>
          <p className="truncate text-meta text-muted-foreground" title={sourceName(source)}>
            {sourceName(source)}
          </p>
        </div>
        <button type="button" onClick={onClose} className={cn("press flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground", FOCUS_RING)} aria-label="Hide the document" title="Hide the document">
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="mx-3 flex items-center gap-1 rounded-xl bg-primary px-2 py-1.5 text-primary-foreground" role="toolbar" aria-label="Document controls">
        <button type="button" className={toolButton} disabled={!paged || page <= 1} onClick={() => setPicked({ forPage: target.page, page: page - 1 })} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-14 rounded-md bg-white/15 px-2 py-0.5 text-center text-meta tabular-nums" aria-live="polite">
          {paged ? `Page ${page}` : "1 / 1"}
        </span>
        <button type="button" className={toolButton} disabled={!paged} onClick={() => setPicked({ forPage: target.page, page: page + 1 })} aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
        <span className="mx-auto" />
        <button type="button" className={toolButton} disabled={zoomIndex === 0} onClick={() => setZoomIndex(zoomIndex - 1)} aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <button type="button" className={cn(toolButton, "w-auto min-w-14 px-2 text-meta tabular-nums")} onClick={() => setZoomIndex(ZOOMS.indexOf(1))} title="Reset zoom" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={toolButton} disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex(zoomIndex + 1)} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button type="button" className={toolButton} onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>

      <div className="m-3 min-h-0 flex-1 overflow-auto rounded-lg border bg-white dark:bg-muted/30">
        <SourceContent source={source} page={page} zoom={zoom} row={target.row} quote={target.quote} />
      </div>

      {target.quote && source.kind !== "text" ? (
        <p className="mx-3 mb-2 rounded-lg bg-tint-amber px-3 py-2 text-meta text-tint-amber-foreground">
          Text the reader used: <span className="italic">{target.quote}</span>
        </p>
      ) : null}

      {source.kind === "image" || source.kind === "pdf" ? (
        <div className="flex items-center gap-1 border-t px-3 py-2">
          <span className="mr-auto truncate text-meta text-muted-foreground">{source.kind === "pdf" ? "PDF" : "Image"} · shown from your upload, not stored</span>
          <a href={source.url} download={source.name} className={cn("press flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-tint-mint hover:text-tint-mint-foreground", FOCUS_RING)} aria-label="Download the document" title="Download">
            <Download className="size-4" />
          </a>
          <a href={source.url} target="_blank" rel="noreferrer" className={cn("press flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-tint-mint hover:text-tint-mint-foreground", FOCUS_RING)} aria-label="Open in a new tab" title="Open in a new tab">
            <ExternalLink className="size-4" />
          </a>
        </div>
      ) : null}

      {/* Drag the right edge to resize (wide screens). */}
      {!fullscreen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the document panel"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width + (event.key === "ArrowRight" ? 24 : -24)))
              setWidth(next)
              window.localStorage.setItem(WIDTH_KEY, String(next))
            }
          }}
          className="absolute top-0 right-0 hidden h-full w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none lg:block"
        />
      ) : null}
    </aside>
  )
}

/** The document itself, at a zoom, on a page (PDF), with the selected row (sheet) or quote (text) highlighted. */
export function SourceContent({ source, page = 1, zoom = 1, row, quote }: { source: SourceView; page?: number; zoom?: number; row?: number; quote?: string }) {
  if (source.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- a local preview of the planner's own file
    return <img src={source.url} alt={`Preview of ${source.name}`} className="mx-auto block max-w-none" style={{ width: `${zoom * 100}%` }} />
  }
  if (source.kind === "pdf") {
    // The browser's own PDF viewer, opened at the page and zoom chosen here.
    return <iframe key={`${page}-${zoom}`} title={`Preview of ${source.name}`} src={`${source.url}#page=${page}&zoom=${Math.round(zoom * 100)}`} className="h-full min-h-96 w-full" />
  }
  return <div style={{ zoom }}>{source.kind === "text" ? <HighlightedText text={source.text} quote={quote} /> : <SheetPreview source={source} row={row} />}</div>
}

/** The original in a plain frame, as the earlier dialog showed it (used where there is no room for the docked panel). */
export function SourcePanel({ source, line }: { source: SourceView; line: ReviewLine | null }) {
  const target = targetOf(line)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
      <div className="min-h-0 flex-1 overflow-auto">
        <SourceContent source={source} page={target.page} row={target.row} quote={target.quote} />
      </div>
      {target.quote && source.kind !== "text" ? (
        <p className="border-t px-3 py-2 text-xs">
          Text the reader used: <span className="italic">{target.quote}</span>
        </p>
      ) : null}
    </div>
  )
}

function HighlightedText({ text, quote }: { text: string; quote: string | undefined }) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1
  return (
    <pre className="p-3 text-xs break-words whitespace-pre-wrap">
      {at >= 0 && quote ? (
        <>
          {text.slice(0, at)}
          <mark className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">{text.slice(at, at + quote.length)}</mark>
          {text.slice(at + quote.length)}
        </>
      ) : (
        text
      )}
    </pre>
  )
}

function SheetPreview({ source, row }: { source: Extract<SourceView, { kind: "sheet" }>; row: number | undefined }) {
  return (
    <div className="text-xs">
      <table className="w-full border-collapse">
        {source.headers ? (
          <thead>
            <tr className="bg-muted/60">
              <th className="sticky top-0 border-b px-2 py-1 text-left font-medium text-muted-foreground">Row</th>
              {source.headers.map((header, index) => (
                <th key={`${header}-${index}`} className="sticky top-0 border-b bg-muted/60 px-2 py-1 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {source.rows.map((entry) => (
            <tr key={entry.rowNumber} className={cn("border-b border-border/60", entry.rowNumber === row && "bg-amber-100 dark:bg-amber-500/20")} aria-current={entry.rowNumber === row ? "true" : undefined}>
              <td className="px-2 py-1 text-muted-foreground tabular-nums">{entry.rowNumber}</td>
              {entry.cells.map((cell, index) => (
                <td key={index} className="max-w-48 truncate px-2 py-1" title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {source.truncated ? <p className="px-3 py-2 text-muted-foreground">Only the top of the sheet is shown here. All rows are read.</p> : null}
      {row !== undefined && !source.rows.some((entry) => entry.rowNumber === row) ? <p className="px-3 py-2 text-muted-foreground">Row {row} is below the part of the sheet shown here.</p> : null}
    </div>
  )
}
