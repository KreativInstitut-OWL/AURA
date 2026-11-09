import { ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, Search } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { Fragment, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { rad2deg } from "@/engine/sh";
import type { AnalysisResult, LfeRouting, TrackDiagnostic } from "@/engine/types";

/** Raw chunk map and axml viewer were debugging aids; flip to true to bring them back. */
const SHOW_DEBUG_BLOCKS = false;


const TAG_TONES = {
  valid: "border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 text-[var(--v2-valid)]",
  accent: "border-accent/40 bg-accent/10 text-accent",
  primary: "border-primary/40 bg-primary/10 text-primary",
  destructive: "border-destructive/50 bg-destructive/10 text-destructive",
  muted: "border-border text-muted-foreground",
  bed: "border-[var(--spatial-bed)]/50 bg-[var(--spatial-bed)]/10 text-[var(--spatial-bed)]",
  obj: "border-[var(--spatial-obj)]/50 bg-[var(--spatial-obj)]/10 text-[var(--spatial-obj)]",
  lfe: "border-[var(--spatial-lfe)]/50 bg-[var(--spatial-lfe)]/10 text-[var(--spatial-lfe)]",
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

function statusLabel(d: TrackDiagnostic, t: (en: string, de: string) => string = (en) => en) {
  if (d.status === "unresolved") return t("unresolved", "ungelöst");
  const base = d.status === "object" ? t("object", "Objekt") : d.status;
  if (d.guessed) return `${base} (${t("guess", "geschätzt")})`;
  return base;
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

/** LFE azimuth/elevation cells reflect the chosen routing, not a fixed omni assumption. */
function lfeAz(routing: LfeRouting, az: number): string {
  if (routing === "omni") return "omni → W";
  if (routing === "down") return "lower hemisphere";
  if (routing === "off") return "off";
  return `${rad2deg(az).toFixed(1)}°`;
}

function lfeEl(routing: LfeRouting, el: number): string {
  if (routing === "down") return "W − Z";
  if (routing === "position") return `${rad2deg(el).toFixed(1)}°`;
  return "—";
}

/** LFE detail follows the active routing instead of the static analysis text. */
function lfeDetail(
  routing: LfeRouting,
  s: { azimuth: number; elevation: number },
  t: (en: string, de: string) => string,
): string {
  if (routing === "omni")
    return t(
      "Omnidirectional — 120 Hz low-pass injected into ACN 0 (W); no directional encoding",
      "Ungerichtet — 120-Hz-Tiefpass nur in ACN 0 (W) eingespeist; keine Richtungskodierung",
    );
  if (routing === "down")
    return t(
      "Lower hemisphere — 120 Hz low-pass encoded as cardioid (W − Z)",
      "Untere Hemisphäre — 120-Hz-Tiefpass als Niere kodiert (W − Z)",
    );
  if (routing === "off") return t("Bypassed — excluded from render", "Deaktiviert — wird nicht gerendert");
  const pos = `${rad2deg(s.azimuth).toFixed(1)}° / ${rad2deg(s.elevation).toFixed(1)}°`;
  return t(
    `Speaker position — 120 Hz low-pass encoded at ${pos}`,
    `Lautsprecherposition — 120-Hz-Tiefpass kodiert bei ${pos}`,
  );
}

export function MetadataInspector({
  analysis,
  lfeRouting = "omni",
}: {
  analysis: AnalysisResult;
  lfeRouting?: LfeRouting;
}) {
  const { t } = useLang();
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
        <Search className="size-4 text-primary" /> {t("Track & Source Inspector", "Spur- & Quell-Inspektor")}
        <span className="ml-auto font-mono text-[11px] normal-case tracking-normal">
          {counts.total} {t("tracks", "Spuren")} · {counts.beds} Bed · {counts.objects} {t("obj", "Obj.")} ·{" "}
          <span className={counts.unresolved ? "text-destructive" : ""}>
            {counts.unresolved} {t("unresolved", "ungelöst")}
          </span>
          {counts.guessed > 0 && <span className="text-accent"> · {counts.guessed} {t("guessed", "geschätzt")}</span>}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {/* Stream map + track resolution traces */}
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("Stream map & resolution trace", "Stream-Übersicht & Auflösungspfad")}
            </p>
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full font-mono text-xs">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">{t("Trk", "Spur")}</th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">{t("Type", "Typ")}</th>
                    <th className="p-2 text-right">{t("Azimuth", "Azimut")}</th>
                    <th className="p-2 text-right">Elevation</th>
                    <th className="p-2 text-left">{t("Motion", "Bewegung")}</th>
                    <th className="p-2 text-left">{t("Detail", "Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.map((d) => {
                    const s = sourceByTrack.get(d.trackIndex);
                    const detail = s?.isLFE ? lfeDetail(lfeRouting, s, t) : d.detail;
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
                            <div className="flex flex-wrap items-center gap-1">
                              {d.status === "unresolved" ? (
                                <Tag tone="destructive">{t("unresolved", "ungelöst")}</Tag>
                              ) : (
                                <Tag tone={s?.isLFE ? "lfe" : s?.kind === "bed" ? "bed" : s?.kind === "object" ? "obj" : "muted"}>
                                  {s?.isLFE ? "LFE" : s?.kind === "bed" ? "Bed" : s?.kind === "object" ? t("Object", "Objekt") : "—"}
                                </Tag>
                              )}
                              {d.guessed && d.status !== "unresolved" && (
                                <Tag tone="muted">{t("guess", "geschätzt")}</Tag>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {!s
                              ? "—"
                              : s.isLFE
                                ? lfeAz(lfeRouting, s.azimuth)
                                : `${rad2deg(s.azimuth).toFixed(1)}°`}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {!s
                              ? "—"
                              : s.isLFE
                                ? lfeEl(lfeRouting, s.elevation)
                                : `${rad2deg(s.elevation).toFixed(1)}°`}
                          </td>

                          <td className="p-2">
                            {s && (
                              <Tag tone={s.points.length ? "primary" : "muted"}>
                                {s.points.length ? `${s.points.length} ${t("keyframes", "Keyframes")}` : t("static", "statisch")}
                              </Tag>
                            )}
                          </td>
                          <td className="max-w-[220px] p-2 text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <span className="min-w-0 truncate" title={detail}>{detail}</span>
                              <ChevronDown
                                className={`size-3 shrink-0 transition-transform ${expanded === d.trackIndex ? "rotate-180" : ""}`}
                              />
                            </div>
                          </td>
                        </tr>
                        {expanded === d.trackIndex && (
                          <tr className="border-t border-border bg-secondary/30">
                            <td colSpan={6} aria-hidden="true" />
                            <td className="max-w-0 p-2 pr-3">
                              {detail && (
                                <p className="mb-2 whitespace-normal break-words text-foreground">{detail}</p>
                              )}
                              <ol className="space-y-1">
                                {d.steps.map((step, i) => (
                                  <li key={i} className="flex flex-wrap items-center gap-2 break-all">
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
              {t("Click a row to see how the app followed that track's references.", "Klicke auf eine Zeile, um zu sehen, wie die App den Referenzen dieser Spur gefolgt ist.")}
            </p>
          </div>


          {/* Chunk map — retired from the UI, kept for future debugging */}
          {SHOW_DEBUG_BLOCKS && (
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("Chunk map", "Chunk-Übersicht")}
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
                    {used ? "" : ` · ${t("ignored", "ignoriert")}`}
                  </span>
                );
              })}
            </div>
          </div>
          )}


          {/* Diagnostics export stays available even with the raw views retired */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void copy("report", buildReport(analysis))}
              className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20"
            >
              <Copy className="size-3" /> {t("Copy diagnostics", "Diagnose kopieren")}
            </button>
            {copied && (
              <span className="self-center font-mono text-[11px] text-muted-foreground">
                {copied === "failed" ? t("copy failed", "Kopieren fehlgeschlagen") : t("copied", "kopiert")}
              </span>
            )}
          </div>

          {/* Raw axml view — retired from the UI, kept for future debugging */}
          {SHOW_DEBUG_BLOCKS && (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                axml ({container.axml ? `${container.axml.length.toLocaleString()} ${t("chars", "Zeichen")}` : t("absent", "fehlt")}
                )
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => void copy("axml", container.axml ?? "")}
                  disabled={!container.axml}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-40"
                >
                  <Copy className="size-3" /> {t("Copy axml", "axml kopieren")}
                </button>
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
              placeholder={t("Search the raw axml…", "Rohes axml durchsuchen…")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-secondary/30 p-3 font-mono text-[11px] leading-relaxed">
              {axmlMatches
                ? axmlMatches.length
                  ? axmlMatches.map((h) => `${h.i}: ${h.text}`).join("\n")
                  : t("no matches", "keine Treffer")
                : (container.axml ?? t("No axml chunk in this file.", "Kein axml-Chunk in dieser Datei.")).slice(0, 20000)}
            </pre>
          </div>
          )}
        </div>
      )}
    </Card>
  );
}
