import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  CircleCheck,
  Download,
  FileAudio,
  Layers,
  Play,
  Radio,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BinauralDeck, type PreviewAudio } from "@/components/adm/BinauralDeck";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MetadataInspector } from "@/components/adm/MetadataInspector";
import { Meters } from "@/components/adm/Meters";
import { SpatialViewer } from "@/components/adm/SpatialViewer";
import { Progress } from "@/components/ui/progress";
import { analyseAdm, BED_ORDER, BED_PROFILES } from "@/engine/adm";
import { parseContainer } from "@/engine/container";
import {
  PREVIEW_MAX_SECONDS,
  previewOrderFor,
  type PreviewRequest,
  type PreviewResponse,
} from "@/engine/preview-types";
import { channelCount, rad2deg } from "@/engine/sh";
import type {
  AnalysisResult,
  BedProfile,
  ContainerInfo,
  LfeMode,
  WorkerRequest,
  WorkerResponse,
} from "@/engine/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AURA — Atmos Universal Renderer into Ambisonics" },
      {
        name: "description",
        content:
          "AURA inspects Dolby Atmos ADM masters and renders them straight into 3rd, 5th or 7th order AmbiX, with binaural audition before download.",
      },
      { property: "og:title", content: "AURA — Atmos Universal Renderer into Ambisonics" },
      {
        property: "og:description",
        content:
          "Stream map, spatial monitoring and AmbiX export with in-browser binaural audition — entirely client-side.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workstation,
});

const ORDERS = [3, 5, 7] as const;
type Order = (typeof ORDERS)[number];

const LFE_MODES: [LfeMode, string, string][] = [
  ["inject", "−3 dB", "standard W injection"],
  ["inject0", "0 dB", "unity"],
  ["inject10", "+10 dB", "Dolby sub calibration"],
  ["exclude", "Off", "LFE excluded"],
];

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
};

const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
};

function Panel({
  title,
  icon,
  right,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-card/60 ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Pill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function Workstation() {
  const [file, setFile] = useState<File | null>(null);
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [profile, setProfile] = useState<BedProfile>("dolby");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [order, setOrder] = useState<Order>(3);
  const [lfeMode, setLfeMode] = useState<LfeMode>("inject");
  const [gainDb, setGainDb] = useState(0);

  const [rendering, setRendering] = useState(false);
  const [framesDone, setFramesDone] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [playhead, setPlayhead] = useState(0);

  const [preview, setPreview] = useState<PreviewAudio | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewPct, setPreviewPct] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const previewWorkerRef = useRef<Worker | null>(null);
  const outChannels = channelCount(order);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      previewWorkerRef.current?.terminate();
    },
    [],
  );

  // Idle trajectory animation
  useEffect(() => {
    if (!analysis || rendering) return;
    let raf = 0;
    const total = analysis.container.frameCount;
    const rate = analysis.container.format.sampleRate;
    const t0 = performance.now();
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      setPlayhead(total > 0 ? (s * rate * 4) % total : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, rendering]);

  const loadFile = useCallback(
    async (f: File) => {
      setError(null);
      setAnalysis(null);
      setContainer(null);
      setResult(null);
      setPreview(null);
      setFile(f);
      setAnalysing(true);
      try {
        const parsed = await parseContainer(f);
        setContainer(parsed);
        setAnalysis(analyseAdm(parsed, profile));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAnalysing(false);
      }
    },
    [profile],
  );

  useEffect(() => {
    if (!container) return;
    try {
      setAnalysis(analyseAdm(container, profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [container, profile]);

  const startRender = useCallback(async () => {
    if (!file || !analysis) return;
    setError(null);
    setResult(null);
    setFramesDone(0);
    setBytesWritten(0);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outName = `${baseName}_AmbiX_O${order}_${outChannels}ch.wav`;

    let handle: FileSystemFileHandle | null = null;
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (picker) {
      try {
        handle = await picker({
          suggestedName: outName,
          types: [{ description: "WAV / RF64", accept: { "audio/wav": [".wav"] } }],
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        handle = null;
      }
    }

    const worker = new Worker(new URL("../engine/render.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setRendering(true);

    worker.onerror = (ev) => {
      setError(`Render worker failed: ${ev.message || "unknown error"}`);
      setRendering(false);
    };

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        setFramesDone(msg.framesDone);
        setPeaks(msg.peaks);
        setBytesWritten(msg.bytesWritten);
        setElapsed(msg.elapsedMs);
        setPlayhead(msg.framesDone);
      } else if (msg.type === "done") {
        setRendering(false);
        setBytesWritten(msg.bytesWritten);
        setElapsed(msg.elapsedMs);
        setResult({ url: msg.blob ? URL.createObjectURL(msg.blob) : "", name: outName });
        worker.terminate();
        workerRef.current = null;
      } else {
        setError(msg.message);
        setRendering(false);
        worker.terminate();
        workerRef.current = null;
      }
    };

    const req: WorkerRequest = {
      type: "render",
      file,
      sources: analysis.sources,
      container: {
        dataOffset: analysis.container.dataOffset,
        frameCount: analysis.container.frameCount,
        blockAlign: analysis.container.format.blockAlign,
        bitsPerSample: analysis.container.format.bitsPerSample,
        channels: analysis.container.format.channels,
        sampleRate: analysis.container.format.sampleRate,
      },
      config: { order, lfeMode, masterGain: Math.pow(10, gainDb / 20) },
      handle,
    };
    worker.postMessage(req);
  }, [analysis, file, gainDb, lfeMode, order, outChannels]);

  const stopRender = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRendering(false);
  };

  const buildPreview = useCallback(() => {
    if (!file || !analysis) return;
    previewWorkerRef.current?.terminate();
    setPreview(null);
    setPreviewPct(0);
    setPreviewing(true);

    const worker = new Worker(new URL("../engine/preview.worker.ts", import.meta.url), {
      type: "module",
    });
    previewWorkerRef.current = worker;
    const previewOrder = previewOrderFor(order);
    const rate = analysis.container.format.sampleRate;

    worker.onerror = (ev) => {
      setError(`Preview failed: ${ev.message || "unknown error"}`);
      setPreviewing(false);
    };

    worker.onmessage = (ev: MessageEvent<PreviewResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        setPreviewPct(msg.totalFrames > 0 ? (msg.framesDone / msg.totalFrames) * 100 : 0);
      } else if (msg.type === "done") {
        setPreview({
          channels: msg.channels,
          sampleRate: msg.sampleRate,
          frameCount: msg.frameCount,
          order: msg.order,
          renderOrder: order,
          truncated: msg.truncated,
          startSec: 0,
        });
        setPreviewing(false);
        worker.terminate();
        previewWorkerRef.current = null;
      } else {
        setError(msg.message);
        setPreviewing(false);
        worker.terminate();
        previewWorkerRef.current = null;
      }
    };

    const req: PreviewRequest = {
      type: "preview",
      file,
      sources: analysis.sources,
      container: {
        dataOffset: analysis.container.dataOffset,
        frameCount: analysis.container.frameCount,
        blockAlign: analysis.container.format.blockAlign,
        bitsPerSample: analysis.container.format.bitsPerSample,
        channels: analysis.container.format.channels,
        sampleRate: rate,
      },
      order: previewOrder,
      lfeMode,
      masterGain: Math.pow(10, gainDb / 20),
      startSample: 0,
      maxFrames: Math.round(PREVIEW_MAX_SECONDS * rate),
    };
    worker.postMessage(req);
  }, [analysis, file, gainDb, lfeMode, order]);

  const total = analysis?.container.frameCount ?? 0;
  const pct = total > 0 ? (framesDone / total) * 100 : 0;
  const speed = elapsed > 0 ? framesDone / (elapsed / 1000) : 0;
  const eta = speed > 0 ? (total - framesDone) / speed : NaN;
  const beds = useMemo(() => analysis?.sources.filter((s) => s.kind === "bed") ?? [], [analysis]);
  const objects = useMemo(
    () => analysis?.sources.filter((s) => s.kind === "object") ?? [],
    [analysis],
  );

  return (
    <div className="v2-theme min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-[var(--v2-valid)]" />
            <span className="text-sm font-semibold tracking-tight">AURA</span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Atmos Universal Renderer into Ambisonics
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              ACN · SN3D · AmbiX
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <div className="inline-flex rounded-full border border-border p-0.5">
              <span className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background">
                Workstation
              </span>
              <Link
                to="/classic"
                className="rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Classic
              </Link>
            </div>
            <div className="inline-flex rounded-full border border-border p-0.5">
              {(["dolby", "itu"] as BedProfile[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProfile(p)}
                  disabled={rendering}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                    profile === p
                      ? "bg-foreground font-semibold text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p === "dolby" ? "Dolby mode" : "ITU mode"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mr-2 inline size-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 p-5 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        {/* ─────────── COLUMN 1 · INPUT ─────────── */}
        <div className="space-y-4">
          <Panel title="Source" icon={<FileAudio className="size-3.5" />}>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) void loadFile(f);
              }}
              className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
                dragging ? "border-[var(--v2-valid)] bg-[var(--v2-valid)]/5" : "border-border"
              }`}
            >
              <p className="text-sm font-medium">Drop a BWF / RF64 ADM master</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Read in slices — multi-gigabyte files are fine.
              </p>
              <label className="mt-3 inline-block">
                <input
                  type="file"
                  accept=".wav,.bwf,.rf64,audio/wav"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadFile(f);
                  }}
                />
                <span className="inline-flex cursor-pointer items-center rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90">
                  Choose file
                </span>
              </label>
            </div>

            {analysing && (
              <p className="mt-3 animate-pulse text-xs text-muted-foreground">
                Scanning container…
              </p>
            )}

            {analysis && (
              <dl className="mt-4 space-y-1.5 font-mono text-[11px]">
                <Row k="File" v={file?.name ?? "—"} />
                <Row k="Size" v={file ? fmtBytes(file.size) : "—"} />
                <Row
                  k="Container"
                  v={analysis.container.isRF64 ? "RF64 + ds64" : "RIFF"}
                />
                <Row
                  k="Format"
                  v={`${analysis.container.format.channels} ch · ${analysis.container.format.bitsPerSample}-bit · ${(analysis.container.format.sampleRate / 1000).toFixed(1)} kHz`}
                />
                <Row k="Duration" v={fmtTime(analysis.container.durationSec)} />
                <Row k="Streams" v={`${beds.length} bed · ${objects.length} objects`} />
                {analysis.programmeName && <Row k="Programme" v={analysis.programmeName} />}
              </dl>
            )}
          </Panel>

          <Panel title="7.1.2 bed reference" icon={<Layers className="size-3.5" />}>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
              A Dolby Atmos bed is at most 7.1.2 — these ten channels. Wide and the remaining
              height positions arrive as dynamic objects and are placed from their own
              coordinates. Explicit coordinates in the file always win over this table.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <tbody>
                  {BED_ORDER.map((r) => {
                    const g = BED_PROFILES[profile][r]!;
                    return (
                      <tr key={r} className="border-b border-border/60 last:border-0">
                        <td className="py-1 pr-2 text-foreground">{r}</td>
                        <td className="py-1 text-right text-muted-foreground">
                          {r === "LFE" ? "omni → W" : `${g.az}° / ${g.el}°`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {analysis && (
            <Panel title="ADM stream map" icon={<Activity className="size-3.5" />}>
              <div className="max-h-[460px] space-y-1.5 overflow-auto pr-1">
                {analysis.sources.map((s) => (
                  <div
                    key={s.channelIndex}
                    className="rounded-lg border border-border bg-background/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px]">
                        <span className="text-muted-foreground">
                          {String(s.channelIndex + 1).padStart(2, "0")}
                        </span>{" "}
                        {s.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${
                          s.isLFE
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : s.kind === "bed"
                              ? "border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 text-[var(--v2-valid)]"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {s.isLFE ? "LFE" : s.kind === "bed" ? "bed" : "object"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-3 font-mono text-[10px] text-muted-foreground">
                      <span>
                        {s.isLFE ? "omni → W" : `az ${rad2deg(s.azimuth).toFixed(1)}°`}
                      </span>
                      {!s.isLFE && <span>el {rad2deg(s.elevation).toFixed(1)}°</span>}
                      <span className="ml-auto">
                        {s.points.length ? `${s.points.length} keyframes` : "static"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {analysis.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                  {analysis.warnings.map((w, i) => (
                    <li key={i}>
                      <TriangleAlert className="mr-1 inline size-3 text-accent" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        {/* ─────────── COLUMN 2 · MONITORING ─────────── */}
        <div className="space-y-4">
          <Panel
            title="Spatial trajectories"
            icon={<Boxes className="size-3.5" />}
            right={
              analysis ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fmtTime(playhead / analysis.container.format.sampleRate)} /{" "}
                  {fmtTime(analysis.container.durationSec)}
                </span>
              ) : null
            }
          >
            {analysis ? (
              <>
                <SpatialViewer
                  sources={analysis.sources}
                  frameCount={analysis.container.frameCount}
                  sampleRate={analysis.container.format.sampleRate}
                  playheadSample={playhead}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Squares are bed anchors, dots are objects on their interpolated paths. Drag to
                  rotate.
                </p>
              </>
            ) : (
              <Empty label="Load an ADM master to see bed anchors and object trajectories." />
            )}
          </Panel>

          <Panel
            title="Output meters"
            icon={<Activity className="size-3.5" />}
            right={
              <span className="font-mono text-[10px] text-muted-foreground">
                {outChannels} ACN channels
              </span>
            }
          >
            <Meters peaks={peaks} channels={outChannels} />
          </Panel>

          {analysis && <MetadataInspector analysis={analysis} />}
          {!analysis && (
            <Panel title="Metadata inspector">
              <Empty label="Chunk map, reference chains and raw axml appear here after loading." />
            </Panel>
          )}
        </div>

        {/* ─────────── COLUMN 3 · OUTPUT ─────────── */}
        <div className="space-y-4">
          <Panel title="Ambisonic order" icon={<Layers className="size-3.5" />}>
            <div className="grid grid-cols-3 gap-2">
              {ORDERS.map((o) => (
                <button
                  key={o}
                  onClick={() => setOrder(o)}
                  disabled={rendering}
                  className={`rounded-lg border px-2 py-2.5 transition-colors disabled:opacity-40 ${
                    order === o
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  <span className="block text-sm font-semibold">{o === 3 ? "3rd" : `${o}th`}</span>
                  <span className="block font-mono text-[10px] opacity-70">
                    {channelCount(o)} ch
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="LFE routing">
            <div className="flex flex-wrap gap-2">
              {LFE_MODES.map(([mode, label, hint]) => (
                <Pill
                  key={mode}
                  active={lfeMode === mode}
                  disabled={rendering}
                  onClick={() => setLfeMode(mode)}
                >
                  {label}
                  <span className="ml-1.5 font-mono text-[9px] opacity-60">{hint}</span>
                </Pill>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              LFE is omnidirectional: a 120 Hz 4th-order Butterworth low-pass is summed into ACN 0
              (W) only, never encoded to a direction.
            </p>
          </Panel>

          <Panel
            title="Master gain"
            right={<span className="font-mono text-[10px]">{gainDb.toFixed(1)} dB</span>}
          >
            <input
              type="range"
              min={-24}
              max={6}
              step={0.5}
              value={gainDb}
              disabled={rendering}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[var(--v2-valid)]"
            />
          </Panel>

          <Panel title="Render & export" icon={<Download className="size-3.5" />}>
            {!rendering ? (
              <button
                onClick={() => void startRender()}
                disabled={!analysis}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Play className="size-4" /> Render {outChannels}-ch AmbiX
              </button>
            ) : (
              <button
                onClick={stopRender}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                <Square className="size-4" /> Stop
              </button>
            )}

            <div className="mt-3">
              <Progress value={pct} />
              <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span>{pct.toFixed(1)}%</span>
                <span>{fmtBytes(bytesWritten)}</span>
                <span>
                  {(speed / (analysis?.container.format.sampleRate || 1)).toFixed(1)}× realtime
                </span>
                <span>ETA {fmtTime(eta)}</span>
              </div>
            </div>

            {result && (
              <div className="mt-3 rounded-lg border border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 p-3 text-xs">
                <CircleCheck className="mr-2 inline size-4 text-[var(--v2-valid)]" />
                Rendered {fmtBytes(bytesWritten)} in {(elapsed / 1000).toFixed(1)} s.
                {result.url ? (
                  <a
                    href={result.url}
                    download={result.name}
                    className="mt-2 flex items-center gap-2 font-mono text-[11px] underline"
                  >
                    <Download className="size-3" /> {result.name}
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Written straight to disk: {result.name}
                  </p>
                )}
              </div>
            )}
          </Panel>

          <BinauralDeck
            preview={preview}
            generating={previewing}
            progress={previewPct}
            canGenerate={!!analysis && !rendering}
            onGenerate={buildPreview}
          />
        </div>
      </div>

      <footer className="border-t border-border px-5 py-6 text-center text-[11px] text-muted-foreground">
        AmbiX output: WAVE_FORMAT_EXTENSIBLE, 24-bit PCM, ACN order, SN3D normalization, RF64
        promotion past 4 GB. Binaural audition: HOAST SH-HRIR set, IEM Graz.
      </footer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-[11px] text-muted-foreground">
      {label}
    </div>
  );
}
