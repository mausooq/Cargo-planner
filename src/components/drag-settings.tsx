"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { MIN_SUPPORT_PCT } from "@/lib/clearance"
import { useEditorSettings } from "@/lib/editor-settings"

export function DragSettingsPanel() {
  const settings = useEditorSettings()

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        <Switch checked={settings.strictMode} onCheckedChange={(strictMode) => settings.patch({ strictMode })} />
        <Label className="text-xs">Strict drops</Label>
      </label>
      <label
        className="flex items-center gap-2"
        title="While dragging: line a piece up exactly on top of another, or slide it flush against neighbours and walls"
      >
        <Switch checked={settings.snapToStack} onCheckedChange={(snapToStack) => settings.patch({ snapToStack })} />
        <Label className="text-xs">Snap to boxes &amp; walls</Label>
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
          min={MIN_SUPPORT_PCT.min}
          max={MIN_SUPPORT_PCT.max}
          step={5}
          title="The smallest share of a stacked piece that must rest on something. Saved with the layout as the project's setting, and used by the packer and the server check."
          value={settings.minSupportPct}
          onChange={(event) =>
            settings.patch({
              minSupportPct: Math.min(MIN_SUPPORT_PCT.max, Math.max(MIN_SUPPORT_PCT.min, Number(event.target.value) || MIN_SUPPORT_PCT.fallback)),
            })
          }
          className="h-7 w-14 rounded-md border bg-background px-1.5 text-foreground"
        />
        %
      </label>
    </div>
  )
}
