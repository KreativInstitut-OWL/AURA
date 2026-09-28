import { ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { rad2deg } from "@/engine/sh";
import type { AnalysisResult, TrackDiagnostic } from "@/engine/types";

const TAG_TONES = {
  valid: "border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 text-[var(--v2-valid)]",
  accent: "border-accent/40 bg-accent/10 text-accent",
  primary: "border-primary/40 bg-primary/10 text-primary",
  destructive: "border-destructive/50 bg-destructive/10 text-destructive",
  muted: "border-border text-muted-foreground",
} as const;

function Tag({
  tone,
  children,
}: {
  tone: keyof typeof TAG_TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusLabel(d: TrackDiagnostic) {
  if (d.status === "unresolved") return "unresolved";
  if (d.guessed) return `${d.status} (guess)`;
  return d.status;
}

function buildReport(analysis: AnalysisResult): string {
  const c = analysis.container;
  const lines: string[] = [];
  lines.push("ADM → Ambisonics · diagnostics report");
  lines.push(
    `container=${c.isRF64 ? "RF64" : "RIFF"} channels=${c.format.channels} bits=${c.format.bitsPerSample} rate=${c.format.sampleRate} frames=${c.frameCount}`,
  );
  lines.push(`programme=${analysis.programmeName ?? "(none)"}`);
  lines.push(`chunks=${c.chunks.map((k) => `${k.id}:${k.size}@${k.offset}`).join(" ")}`);
  lines.push(`axml=${c.axml ? `${c.axml.length} chars` : "absent"} chna=${c.chna.length} entries`);
  lines.push("");
  for (const d of analysis.diagnostics) {
    lines.push(`#${d.trackIndex} ${d.uid} [${statusLabel(d)}] ${d.name} — ${d.detail}`);
    for (const s of d.steps) lines.push(`    ${s.ok ? "ok " : "FAIL"} ${s.label}: ${s.value ?? ""}`);
  }
  if (analysis.warnings.length) {
    lines.push("");
    lines.push("warnings:");
    for (const w of analysis.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

export function MetadataInspector({ analysis }: { analysis: AnalysisResult }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const { container, diagnostics } = analysis;

  /** the stream map lives in the same table: sources are keyed by 1-based track */
  const sourceByTrack = useMemo(
    () => new Map(analysis.sources.map((s) => [s.channelIndex + 1, s])),
    [analysis.sources],
  );



  const counts = useMemo(() => {
    const beds = diagnostics.filter((d) => d.status === "bed").length;
    const objects = diagnostics.filter((d) => d.status === "object").length;
    const unresolved = diagnostics.filter((d) => d.status === "unresolved").length;
    const guessed = diagnostics.filter((d) => d.guessed).length;
    return { total: diagnostics.length, beds, objects, unresolved, guessed };
  }, [diagnostics]);

  const elementCounts = useMemo(() => {
    if (!container.axml) return [] as [string, number][];
    const map = new Map<string, number>();
    for (const m of container.axml.matchAll(/<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s/>]/g)) {
      const name = m[2]!;
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [container.axml]);

  const axmlMatches = useMemo(() => {
    if (!container.axml || query.trim().length < 2) return null;
    const q = query.trim().toLowerCase();
    const lines = container.axml.split(/\r?\n/);
    const hits: { i: number; text: string }[] = [];
    for (let i = 0; i < lines.length && hits.length < 200; i++) {
      if (lines[i]!.toLowerCase().includes(q)) hits.push({ i: i + 1, text: lines[i]!.trim() });
    }
    return hits;
  }, [container.axml, query]);

  const copy = async (what: string, textValue: string) => {
    try {
      await navigator.clipboard.writeText(textValue);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("failed");
    }
  };

  return (
    <Card className="mt-4 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Search className="size-4 text-primary" /> Metadata inspector
        <span className="ml-auto font-mono text-[11px] normal-case tracking-normal">
          {counts.total} tracks · {counts.beds} bed · {counts.objects} obj ·{" "}
          <span className={counts.unresolved ? "text-destructive" : ""}>
            {counts.unresolved} unresolved
          </span>
          {counts.guessed > 0 && <span className="text-accent"> · {counts.guessed} guessed</span>}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {/* Stream map + track resolution traces */}
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              Stream map & resolution trace
            </p>
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full font-mono text-xs">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Trk</th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-right">Az</th>
                    <th className="p-2 text-right">El</th>
                    <th className="p-2 text-left">Motion</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map((d) => {
                    const s = sourceByTrack.get(d.trackIndex);
                    return (
                      <Fragment key={d.trackIndex}>
                        <tr
                          onClick={() =>
                            setExpanded((v) => (v === d.trackIndex ? null : d.trackIndex))
                          }
                          className="cursor-pointer border-t border-border hover:bg-secondary/60"
                        >
                          <td className="p-2">{String(d.trackIndex).padStart(2, "0")}</td>
                          <td className="p-2">{d.name}</td>
                          <td className="p-2">
                            <Tag
                              tone={
                                s?.isLFE
                                  ? "accent"
                                  : s?.kind === "bed"
                                    ? "valid"
                                    : s
                                      ? "muted"
                                      : "muted"
                              }
                            >
                              {s?.isLFE ? "LFE" : (s?.kind ?? "—")}
                            </Tag>
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {!s ? "—" : s.isLFE ? "omni → W" : `${rad2deg(s.azimuth).toFixed(1)}°`}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {!s || s.isLFE ? "—" : `${rad2deg(s.elevation).toFixed(1)}°`}
                          </td>
                          <td className="p-2">
                            {s && (
                              <Tag tone={s.points.length ? "primary" : "muted"}>
                                {s.points.length ? `${s.points.length} keyframes` : "static"}
                              </Tag>
                            )}
                          </td>
                          <td className="p-2">
                            <Tag
                              tone={
                                d.status === "unresolved"
                                  ? "destructive"
                                  : d.guessed
                                    ? "accent"
                                    : "primary"
                              }
                            >
                              {statusLabel(d)}
                            </Tag>
                          </td>
                          <td className="p-2 text-muted-foreground">{d.detail}</td>
                        </tr>
                        {expanded === d.trackIndex && (
                          <tr className="border-t border-border bg-secondary/30">
                            <td colSpan={8} className="p-2">
                              <ol className="space-y-1">
                                {d.steps.map((step, i) => (
                                  <li key={i} className="flex items-center gap-2">
                                    {step.ok ? (
                                      <CircleCheck className="size-3 text-primary" />
                                    ) : (
                                      <CircleX className="size-3 text-destructive" />
                                    )}
                                    <span className="text-muted-foreground">{step.label}</span>
                                    <span>{step.value}</span>
                                  </li>
                                ))}
                              </ol>
                              <p className="mt-2 text-[11px] text-muted-foreground">
                                UID {d.uid}
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Click a row to see how the app followed that track's references.
            </p>
          </div>


          {/* Chunk map */}
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              Chunk map
            </p>
            <div className="flex flex-wrap gap-2 font-mono text-[11px]">
              {container.chunks.map((k) => {
                const used = ["fmt ", "data", "chna", "axml", "ds64"].includes(k.id);
                return (
                  <span
                    key={`${k.id}-${k.offset}`}
                    className={`rounded border px-2 py-1 ${
                      used
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {k.id.trim()} · {k.size.toLocaleString()} B @ {k.offset.toLocaleString()}
                    {used ? "" : " · ignored"}
                  </span>
                );
              })}
            </div>
          </div>

          {/* axml */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                axml ({container.axml ? `${container.axml.length.toLocaleString()} chars` : "absent"}
                )
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => void copy("axml", container.axml ?? "")}
                  disabled={!container.axml}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-40"
                >
                  <Copy className="size-3" /> Copy axml
                </button>
                <button
                  onClick={() => void copy("report", buildReport(analysis))}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20"
                >
                  <Copy className="size-3" /> Copy diagnostics
                </button>
                {copied && (
                  <span className="self-center font-mono text-[11px] text-muted-foreground">
                    {copied === "failed" ? "copy failed" : "copied"}
                  </span>
                )}
              </div>
            </div>

            {elementCounts.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground">
                {elementCounts.map(([name, n]) => (
                  <span key={name} className="rounded border border-border px-2 py-0.5">
                    {name} <span className="text-primary">{n}</span>
                  </span>
                ))}
              </div>
            )}

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the raw axml…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-secondary/30 p-3 font-mono text-[11px] leading-relaxed">
              {axmlMatches
                ? axmlMatches.length
                  ? axmlMatches.map((h) => `${h.i}: ${h.text}`).join("\n")
                  : "no matches"
                : (container.axml ?? "No axml chunk in this file.").slice(0, 20000)}
            </pre>
          </div>
        </div>
      )}
    </Card>
  );
}
