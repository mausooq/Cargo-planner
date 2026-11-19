"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useEditorSettings } from "@/lib/editor-settings"

export function DragSettingsPanel() {
  const settings = useEditorSettings()

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        <Switch checked={settings.strictMode} onCheckedChange={(strictMode) => settings.patch({ strictMode })} />
        <Label className="text-xs">Strict drops</Label>
      </label>
      <label className="flex items-center gap-2" title="When you drag a piece onto another, line it up exactly on top (same edges, or centred)">
        <Switch checked={settings.snapToStack} onCheckedChange={(snapToStack) => settings.patch({ snapToStack })} />
        <Label className="text-xs">Snap when stacking</Label>
      </label>
      <label className="flex items-center gap-2">
        <Switch checked={settings.clampToWalls} onCheckedChange={(clampToWalls) => settings.patch({ clampToWalls })} />
        <Label className="text-xs">Slide along walls</Label>
      </label>
      <label className="flex items-center gap-2">
        <Switch
          checked={settings.colourBlindPalette}
          onCheckedChange={(colourBlindPalette) => settings.patch({ colourBlindPalette })}
        />
        <Label className="text-xs">Blue / orange palette</Label>
      </label>
      <label className="flex items-center gap-2">
        Min support
        <input
          type="number"
          min={10}
          max={100}
          step={5}
          value={settings.minSupportPct}
          onChange={(event) => settings.patch({ minSupportPct: Math.min(100, Math.max(10, Number(event.target.value) || 70)) })}
          className="h-7 w-14 rounded-md border bg-background px-1.5 text-foreground"
        />
        %
      </label>
    </div>
  )
}
