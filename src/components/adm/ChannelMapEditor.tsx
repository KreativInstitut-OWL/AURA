import { TriangleAlert } from "lucide-react";

import { ALL_SPEAKER_ROLES, CHANNEL_UNUSED, SMPTE_LAYOUT_NAME } from "@/engine/adm";

interface Props {
  map: string[];
  onChange: (map: string[]) => void;
  onReset: () => void;
  disabled?: boolean | undefined;
}

/**
 * Shown only for files without ADM metadata: the channel order of a plain
 * multichannel render differs between tools, so every assumed loudspeaker
 * assignment stays visible and editable.
 */
export function ChannelMapEditor({ map, onChange, onReset, disabled }: Props) {
  const layout = SMPTE_LAYOUT_NAME[map.length];
  const duplicates = new Set(
    map.filter((r, i) => r !== CHANNEL_UNUSED && map.indexOf(r) !== i),
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-accent/50 bg-accent/10 p-3 text-[11px] leading-relaxed text-foreground">
        <TriangleAlert className="mr-1.5 inline size-3.5 text-accent" />
        No ADM metadata in this file. Loudspeaker positions are <strong>assumed</strong> from the
        channel order
        {layout ? ` of a ${layout} layout` : ""}. There is no universal order across renderers —
        check every channel below before rendering.
      </div>

      <div className="max-h-[340px] space-y-1 overflow-auto pr-1">
        {map.map((role, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-7 shrink-0 font-mono text-[11px] text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            <select
              value={role}
              disabled={disabled}
              onChange={(e) => {
                const picked = e.target.value;
                const next = [...map];
                // Role stealing: a loudspeaker belongs to exactly one channel.
                if (picked !== CHANNEL_UNUSED) {
                  const held = next.indexOf(picked);
                  if (held >= 0 && held !== i) next[held] = CHANNEL_UNUSED;
                }
                next[i] = picked;
                onChange(next);
              }}
              className={`w-full rounded-md border bg-background px-2 py-1.5 font-mono text-[11px] disabled:opacity-40 ${
                duplicates.has(role) ? "border-destructive text-destructive" : "border-border"
              }`}
            >
              <option value={CHANNEL_UNUSED}>{CHANNEL_UNUSED} unused</option>
              {ALL_SPEAKER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {duplicates.size > 0 && (
        <p className="text-[11px] text-destructive">
          Assigned twice: {[...duplicates].join(", ")} — each loudspeaker should appear once.
        </p>
      )}

      <button
        onClick={onReset}
        disabled={disabled}
        className="w-full rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
      >
        Reset to assumed order
      </button>
    </div>
  );
}
