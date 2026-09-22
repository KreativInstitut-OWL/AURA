import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AudioWaveform,
  Boxes,
  CircleCheck,
  CircleX,
  Download,
  FileAudio,
  Globe,
  Play,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Meters } from "@/components/adm/Meters";
import { SpatialViewer } from "@/components/adm/SpatialViewer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { analyseAdm } from "@/engine/adm";
import { parseContainer } from "@/engine/container";
import { channelCount, rad2deg, verifyBasis } from "@/engine/sh";
import type {
  AmbiOrderAlias,
  AnalysisResult,
  LfeMode,
  WorkerRequest,
  WorkerResponse,
} from "@/engine/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ADM → Ambisonics Direct Renderer" },
      {
        name: "description",
        content:
          "Render Dolby Atmos ADM BWF/RF64 masters straight into 3rd, 5th or 7th order AmbiX (ACN/SN3D) in the browser — no virtual loudspeaker stage.",
      },
      { property: "og:title", content: "ADM → Ambisonics Direct Renderer" },
      {
        property: "og:description",
        content:
          "Object-level spherical harmonic encoding of Atmos beds and objects to 16/36/64-channel AmbiX, streamed entirely client-side.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const ORDERS = [3, 5, 7] as const;
type Order = (typeof ORDERS)[number];

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
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>(3);
  const [lfeMode, setLfeMode] = useState<LfeMode>("inject");
  const [gainDb, setGainDb] = useState(0);
  const [dragging, setDragging] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [framesDone, setFramesDone] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [playhead, setPlayhead] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const selfTest = useMemo(() => verifyBasis(), []);
  const outChannels = channelCount(order);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Idle trajectory animation when not rendering
  useEffect(() => {
    if (!analysis || rendering) return;
    let raf = 0;
    const total = analysis.container.frameCount;
    const rate = analysis.container.sampleRate;
    const t0 = performance.now();
    const tick = () => {
      const elapsedSec = (performance.now() - t0) / 1000;
      setPlayhead(total > 0 ? ((elapsedSec * rate * 4) % total) : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, rendering]);

  const loadFile = useCallback(async (f: File) => {
    setError(null);
    setAnalysis(null);
    setResult(null);
    setFile(f);
    setAnalysing(true);
    try {
      const container = await parseContainer(f);
      setAnalysis(analyseAdm(container));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysing(false);
    }
  }, []);

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
      } catch {
        return; // user cancelled
      }
    }

    const worker = new Worker(new URL("../engine/render.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setRendering(true);

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
        if (msg.blob) setResult({ url: URL.createObjectURL(msg.blob), name: outName });
        else setResult({ url: "", name: outName });
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
        sampleRate: analysis.container.sampleRate ?? analysis.container.format.sampleRate,
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

  const total = analysis?.container.frameCount ?? 0;
  const pct = total > 0 ? (framesDone / total) * 100 : 0;
  const speed = elapsed > 0 ? framesDone / (elapsed / 1000) : 0;
  const eta = speed > 0 ? (total - framesDone) / speed : NaN;
  const beds = analysis?.sources.filter((s) => s.kind === "bed") ?? [];
  const objects = analysis?.sources.filter((s) => s.kind === "object") ?? [];

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <Globe className="size-3 text-primary" /> ACN · SN3D · AmbiX
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          ADM <span className="text-primary">→</span> Ambisonics Direct Renderer
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Dolby Atmos ADM masters encoded straight into higher-order Ambisonics. Every bed channel
          and every object is encoded from its own coordinates — no virtual loudspeaker stage, no
          phantom-source blur. Everything runs in this browser tab.
        </p>
      </header>

      {/* Dropzone */}
      <Card
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
        className={`border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <FileAudio className="mx-auto size-8 text-primary" />
        <p className="mt-3 font-medium">Drop a BWF / RF64 Atmos ADM master here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Multi-gigabyte files are fine — they are read in slices, never loaded whole.
        </p>
        <label className="mt-4 inline-block">
          <input
            type="file"
            accept=".wav,.bwf,.rf64,audio/wav"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
          />
          <span className="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Choose file
          </span>
        </label>
        {file && (
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            {file.name} · {fmtBytes(file.size)}
          </p>
        )}
      </Card>

      {analysing && (
        <p className="mt-4 animate-pulse text-sm text-muted-foreground">Scanning container…</p>
      )}
      {error && (
        <Card className="mt-4 border-destructive/50 p-4 text-sm text-destructive">
          <TriangleAlert className="mr-2 inline size-4" />
          {error}
        </Card>
      )}

      {analysis && (
        <>
          {/* Container analysis */}
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <Stat label="Container" value={analysis.container.isRF64 ? "RF64 + ds64" : "RIFF"} />
            <Stat
              label="Format"
              value={`${analysis.container.format.channels} ch · ${analysis.container.format.bitsPerSample}-bit · ${(analysis.container.format.sampleRate / 1000).toFixed(1)} kHz`}
            />
            <Stat label="Duration" value={fmtTime(analysis.container.durationSec)} />
            <Stat
              label="ADM streams"
              value={`${beds.length} bed · ${objects.length} objects`}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            {/* Viewer */}
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Boxes className="size-4 text-primary" /> Spatial trajectories
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtTime(playhead / analysis.container.sampleRate)} /{" "}
                  {fmtTime(analysis.container.durationSec)}
                </span>
              </div>
              <SpatialViewer
                sources={analysis.sources}
                frameCount={analysis.container.frameCount}
                sampleRate={analysis.container.sampleRate}
                playheadSample={playhead}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Squares are 7.1.2 bed anchors, amber dots are objects on their interpolated paths.
                Drag to rotate.
              </p>
            </Card>

            {/* Controls */}
            <Card className="space-y-5 p-4">
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Ambisonic order
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {ORDERS.map((o) => (
                    <button
                      key={o}
                      onClick={() => setOrder(o)}
                      disabled={rendering}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        order === o
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      <span className="block font-semibold">{o}rd</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {channelCount(o)} ch
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  LFE routing
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["inject", "Inject to W (-3 dB)"],
                      ["exclude", "Exclude LFE"],
                    ] as [LfeMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setLfeMode(mode)}
                      disabled={rendering}
                      className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                        lfeMode === mode
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Injection applies a 120 Hz 4th-order Butterworth low-pass to ACN 0 only.
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                    Master gain
                  </span>
                  <span className="font-mono text-xs">{gainDb.toFixed(1)} dB</span>
                </div>
                <Slider
                  value={[gainDb]}
                  min={-24}
                  max={6}
                  step={0.5}
                  disabled={rendering}
                  onValueChange={(v) => setGainDb(v[0] ?? 0)}
                />
              </div>

              <div className="flex gap-2">
                {!rendering ? (
                  <Button className="flex-1" onClick={() => void startRender()}>
                    <Play className="size-4" /> Render {outChannels}-ch AmbiX
                  </Button>
                ) : (
                  <Button className="flex-1" variant="destructive" onClick={stopRender}>
                    <Square className="size-4" /> Stop
                  </Button>
                )}
              </div>
              {result && (
                <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
                  <CircleCheck className="mr-2 inline size-4 text-primary" />
                  Rendered {fmtBytes(bytesWritten)} in {(elapsed / 1000).toFixed(1)} s.
                  {result.url ? (
                    <a
                      href={result.url}
                      download={result.name}
                      className="mt-2 flex items-center gap-2 font-mono text-xs text-primary underline"
                    >
                      <Download className="size-3" /> {result.name}
                    </a>
                  ) : (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Written straight to disk: {result.name}
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Render progress + meters */}
          <Card className="mt-4 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Activity className="size-4 text-primary" /> Streaming render
              </h2>
              <div className="flex gap-4 font-mono text-xs text-muted-foreground">
                <span>{pct.toFixed(1)}%</span>
                <span>{fmtBytes(bytesWritten)} written</span>
                <span>{(speed / (analysis.container.sampleRate || 1)).toFixed(1)}× realtime</span>
                <span>ETA {fmtTime(eta)}</span>
              </div>
            </div>
            <Progress value={pct} />
            <div className="mt-4">
              <Meters peaks={peaks} channels={outChannels} />
            </div>
          </Card>

          {/* Stream table */}
          <Card className="mt-4 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <AudioWaveform className="size-4 text-primary" /> ADM stream map
            </h2>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full font-mono text-xs">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Trk</th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">UID</th>
                    <th className="p-2 text-right">Az</th>
                    <th className="p-2 text-right">El</th>
                    <th className="p-2 text-right">Keyframes</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.sources.map((s) => (
                    <tr key={s.channelIndex} className="border-t border-border">
                      <td className="p-2">{s.channelIndex + 1}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2">
                        <span
                          className={s.kind === "bed" ? "text-primary" : "text-accent"}
                        >
                          {s.isLFE ? "LFE" : s.kind === "bed" ? "DirectSpeakers" : "Object"}
                        </span>
                      </td>
                      <td className="p-2 text-muted-foreground">{s.uid}</td>
                      <td className="p-2 text-right">{rad2deg(s.azimuth).toFixed(1)}°</td>
                      <td className="p-2 text-right">{rad2deg(s.elevation).toFixed(1)}°</td>
                      <td className="p-2 text-right">{s.points.length || "static"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysis.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {analysis.warnings.map((w, i) => (
                  <li key={i}>
                    <TriangleAlert className="mr-1 inline size-3 text-accent" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* Math self-test */}
      <Card className="mt-6 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Spherical harmonic self-test (ACN / SN3D)
        </h2>
        <ul className="space-y-1 text-xs">
          {selfTest.map((t) => (
            <li key={t.name} className="flex items-center gap-2">
              {t.ok ? (
                <CircleCheck className="size-3.5 text-primary" />
              ) : (
                <CircleX className="size-3.5 text-destructive" />
              )}
              <span>{t.name}</span>
              <span className="font-mono text-muted-foreground">— {t.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        AmbiX output: WAVE_FORMAT_EXTENSIBLE, 24-bit PCM, ACN order, SN3D normalization, RF64
        promotion past 4 GB.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm">{value}</p>
    </Card>
  );
}

export type { AmbiOrderAlias };
