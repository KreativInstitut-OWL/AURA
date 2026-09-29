import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  CircleCheck,
  Download,
  FileAudio,
  Layers,
  Play,
  Radio,
  ShieldCheck,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { PrivacyDialog, usePrivacyDialog } from "@/components/PrivacyDialog";
import { useLang } from "@/lib/i18n";
import { ChannelMapEditor } from "@/components/adm/ChannelMapEditor";
import { MetadataInspector } from "@/components/adm/MetadataInspector";
import { Meters } from "@/components/adm/Meters";
import { SpatialViewer } from "@/components/adm/SpatialViewer";
import { Progress } from "@/components/ui/progress";
import { analyseAdm, BED_ORDER, BED_PROFILES, defaultChannelMap } from "@/engine/adm";
import { parseContainer } from "@/engine/container";
import { channelCount } from "@/engine/sh";

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
      { title: "AURA — ADM Universal Renderer into Ambisonics" },
      {
        name: "description",
        content:
          "AURA inspects ADM (ITU-R BS.2076) masters and renders them straight into 3rd, 5th or 7th order AmbiX — entirely inside your browser.",
      },
      { property: "og:title", content: "AURA — ADM Universal Renderer into Ambisonics" },
      {
        property: "og:description",
        content:
          "Stream map, spatial monitoring and AmbiX export from ADM masters — entirely client-side, nothing is uploaded.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workstation,
});

const ORDERS = [3, 5, 7] as const;

type Order = (typeof ORDERS)[number];

const LFE_MODES: [LfeMode, string, string, string, string][] = [
  ["inject", "−3 dB", "−3 dB", "standard W injection", "Standard-W-Einspeisung"],
  ["inject0", "0 dB", "0 dB", "unity", "Unity"],
  ["inject10", "+10 dB", "+10 dB", "Dolby sub calibration", "Dolby-Sub-Kalibrierung"],
  ["exclude", "Off", "Aus", "LFE excluded", "LFE ausgeschlossen"],
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
  const { t, lang, setLang } = useLang();
  const privacy = usePrivacyDialog();
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
  /** peak report of the last finished render, in dBFS */
  const [clip, setClip] = useState<{
    peakDb: number;
    channel: number;
    suggestedGain: number;
  } | null>(null);

  /** channel → loudspeaker assignment, only used for files without ADM metadata */
  const [channelMap, setChannelMap] = useState<string[] | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const outChannels = channelCount(order);
  const needsChannelMap = !!container && (!container.axml || container.chna.length === 0);

  useEffect(() => () => workerRef.current?.terminate(), []);

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
      setChannelMap(null);
      setFile(f);
      setAnalysing(true);
      try {
        const parsed = await parseContainer(f);
        const map =
          !parsed.axml || parsed.chna.length === 0
            ? defaultChannelMap(parsed.format.channels)
            : null;
        setChannelMap(map);
        setContainer(parsed);
        setAnalysis(analyseAdm(parsed, profile, map ?? undefined));
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
      setAnalysis(analyseAdm(container, profile, channelMap ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [container, profile, channelMap]);




  const startRender = useCallback(async () => {
    if (!file || !analysis) return;
    setError(null);
    setResult(null);
    setFramesDone(0);
    setBytesWritten(0);

    setClip(null);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const hasLfe = analysis.sources.some((s) => s.isLFE);
    const lfeTag = !hasLfe
      ? ""
      : lfeMode === "inject"
        ? "_LFE-3dB"
        : lfeMode === "inject0"
          ? "_LFE0dB"
          : lfeMode === "inject10"
            ? "_LFE+10dB"
            : "_noLFE";
    // Only tag the gain when it differs from unity.
    const gainTag =
      gainDb === 0
        ? ""
        : `_gain${gainDb > 0 ? "+" : "-"}${Math.abs(gainDb).toFixed(1).replace(/\.0$/, "")}dB`;
    const outName = `${baseName}_AmbiX_${order}OA${lfeTag}${gainTag}_AURA.wav`;

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
        // Peak is measured in 32-bit float before 24-bit quantisation clamps it.
        const peakDb = msg.maxPeak > 0 ? 20 * Math.log10(msg.maxPeak) : -Infinity;
        const suggested =
          peakDb > 0 ? Math.max(-24, Math.floor((gainDb - peakDb - 0.2) * 2) / 2) : gainDb;
        setClip({ peakDb, channel: msg.maxPeakChannel, suggestedGain: suggested });
        const url = msg.blob ? URL.createObjectURL(msg.blob) : "";
        setResult({ url, name: outName });
        if (url) {
          // Start the download right away so the file lands in Downloads.
          const a = document.createElement("a");
          a.href = url;
          a.download = outName;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
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

  // "apply suggested gain & re-render": set the slider, then start once state settled
  const [pendingRerender, setPendingRerender] = useState(false);
  useEffect(() => {
    if (!pendingRerender || rendering) return;
    setPendingRerender(false);
    void startRender();
  }, [pendingRerender, rendering, startRender]);


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
              ADM Universal Renderer into Ambisonics
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              ACN · SN3D · AmbiX
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => privacy.setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ShieldCheck className="size-3.5 text-[var(--v2-valid)]" />
              {t("Runs locally", "Läuft lokal")}
            </button>
            <ThemeToggle />
            <div className="inline-flex rounded-full border border-border p-0.5">
              {(["de", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[11px] uppercase transition-colors ${
                    lang === l
                      ? "bg-foreground font-semibold text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
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
                  {p === "dolby" ? t("Dolby mode", "Dolby-Modus") : t("ITU mode", "ITU-Modus")}
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
          <Panel title={t("Source", "Quelle")} icon={<FileAudio className="size-3.5" />}>
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
              <p className="text-sm font-medium">{t("Drop a BWF / RF64 ADM master", "BWF- / RF64-ADM-Master hier ablegen")}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("Read in slices — multi-gigabyte files are fine. Nothing is uploaded.", "Wird stückweise gelesen — auch mehrere Gigabyte sind kein Problem. Nichts wird hochgeladen.")}
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
                  {t("Choose file", "Datei wählen")}
                </span>
              </label>
            </div>

            {analysing && (
              <p className="mt-3 animate-pulse text-xs text-muted-foreground">
                {t("Scanning container…", "Container wird gelesen…")}
              </p>
            )}

            {analysis && (
              <dl className="mt-4 space-y-1.5 font-mono text-[11px]">
                <Row k={t("File", "Datei")} v={file?.name ?? "—"} />
                <Row k={t("Size", "Größe")} v={file ? fmtBytes(file.size) : "—"} />
                <Row
                  k="Container"
                  v={analysis.container.isRF64 ? "RF64 + ds64" : "RIFF"}
                />
                <Row
                  k="Format"
                  v={`${analysis.container.format.channels} ch · ${analysis.container.format.bitsPerSample}-bit · ${(analysis.container.format.sampleRate / 1000).toFixed(1)} kHz`}
                />
                <Row k={t("Duration", "Dauer")} v={fmtTime(analysis.container.durationSec)} />
                <Row k="Streams" v={`${beds.length} Bed · ${objects.length} ${t("objects", "Objekte")}`} />
                {analysis.programmeName && <Row k={t("Programme", "Programm")} v={analysis.programmeName} />}
              </dl>
            )}
          </Panel>

          {needsChannelMap && channelMap && (
            <Panel
              title={t("Channel assignment", "Kanalzuordnung")}
              icon={<Layers className="size-3.5" />}
              className="border-accent/60 bg-accent/5"
            >
              <ChannelMapEditor
                map={channelMap}
                onChange={setChannelMap}
                onReset={() => setChannelMap(defaultChannelMap(container!.format.channels))}
                disabled={rendering}
              />
            </Panel>
          )}



          <Panel title={t("7.1.2 bed reference", "7.1.2-Bed-Referenz")} icon={<Layers className="size-3.5" />}>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "A Dolby Atmos bed is at most 7.1.2 — these ten channels. Wide and the remaining height positions arrive as dynamic objects and are placed from their own coordinates. Explicit coordinates in the file always win over this table.",
                "Ein Dolby-Atmos-Bed umfasst höchstens 7.1.2 — diese zehn Kanäle. Wide- und weitere Höhenpositionen kommen als dynamische Objekte und werden nach ihren eigenen Koordinaten platziert. Explizite Koordinaten in der Datei haben immer Vorrang vor dieser Tabelle.",
              )}
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

          {analysis && analysis.warnings.length > 0 && (
            <Panel title={t("Warnings", "Warnungen")} icon={<TriangleAlert className="size-3.5" />}>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {analysis.warnings.map((w, i) => (
                  <li key={i}>
                    <TriangleAlert className="mr-1 inline size-3 text-accent" />
                    {w}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* ─────────── COLUMN 2 · MONITORING ─────────── */}
        <div className="space-y-4">
          <Panel
            title={t("Spatial trajectories", "Räumliche Bewegungspfade")}
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
                  {t("Squares are bed anchors, dots are objects on their interpolated paths. Drag to rotate.", "Quadrate sind Bed-Anker, Punkte sind Objekte auf ihren interpolierten Pfaden. Zum Drehen ziehen.")}
                </p>
              </>
            ) : (
              <Empty label={t("Load an ADM master to see bed anchors and object trajectories.", "Lade einen ADM-Master, um Bed-Anker und Objektpfade zu sehen.")} />
            )}
          </Panel>

          <Panel
            title={t("Output meters", "Ausgangspegel")}
            icon={<Activity className="size-3.5" />}
            right={
              <span className="font-mono text-[10px] text-muted-foreground">
                {outChannels} {t("ACN channels", "ACN-Kanäle")}
              </span>
            }
          >
            <Meters peaks={peaks} channels={outChannels} />
          </Panel>

          {analysis && <MetadataInspector analysis={analysis} />}
          {!analysis && (
            <Panel title={t("Metadata inspector", "Metadaten-Inspektor")}>
              <Empty label={t("Chunk map, reference chains and raw axml appear here after loading.", "Chunk-Übersicht, Referenzketten und rohes axml erscheinen hier nach dem Laden.")} />
            </Panel>
          )}
        </div>

        {/* ─────────── COLUMN 3 · OUTPUT ─────────── */}
        <div className="space-y-4">
          <Panel title={t("Ambisonic order", "Ambisonics-Ordnung")} icon={<Layers className="size-3.5" />}>
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
                  <span className="block text-sm font-semibold">{lang === "de" ? `${o}.` : o === 3 ? "3rd" : `${o}th`}</span>
                  <span className="block font-mono text-[10px] opacity-70">
                    {channelCount(o)} {t("ch", "Kan.")}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title={t("LFE routing", "LFE-Routing")}>
            <div className="flex flex-wrap gap-2">
              {LFE_MODES.map(([mode, labelEn, labelDe, hintEn, hintDe]) => (
                <Pill
                  key={mode}
                  active={lfeMode === mode}
                  disabled={rendering}
                  onClick={() => setLfeMode(mode)}
                >
                  {t(labelEn, labelDe)}
                  <span className="ml-1.5 font-mono text-[9px] opacity-60">{t(hintEn, hintDe)}</span>
                </Pill>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "LFE is omnidirectional: a 120 Hz 4th-order Butterworth low-pass is summed into ACN 0 (W) only, never encoded to a direction.",
                "LFE ist omnidirektional: Ein 120-Hz-Butterworth-Tiefpass 4. Ordnung wird nur in ACN 0 (W) summiert und nie in eine Richtung kodiert.",
              )}
            </p>
          </Panel>

          <Panel
            title={t("Master gain", "Gesamtpegel")}
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

          <Panel title={t("Render & export", "Rendern & Export")} icon={<Download className="size-3.5" />}>
            {!rendering ? (
              <button
                onClick={() => void startRender()}
                disabled={!analysis}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Play className="size-4" /> {t(`Render ${outChannels}-ch AmbiX`, `${outChannels}-Kanal-AmbiX rendern`)}
              </button>
            ) : (
              <button
                onClick={stopRender}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                <Square className="size-4" /> {t("Stop", "Stopp")}
              </button>
            )}

            <div className="mt-3">
              <Progress value={pct} />
              <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span>{pct.toFixed(1)}%</span>
                <span>{fmtBytes(bytesWritten)}</span>
                <span>
                  {(speed / (analysis?.container.format.sampleRate || 1)).toFixed(1)}× {t("realtime", "Echtzeit")}
                </span>
                <span>ETA {fmtTime(eta)}</span>
              </div>
            </div>

            {result && (
              <div className="mt-3 rounded-lg border border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 p-3 text-xs">
                <CircleCheck className="mr-2 inline size-4 text-[var(--v2-valid)]" />
                {t(`Rendered ${fmtBytes(bytesWritten)} in ${(elapsed / 1000).toFixed(1)} s.`, `${fmtBytes(bytesWritten)} in ${(elapsed / 1000).toFixed(1)} s gerendert.`)}
                {result.url ? (
                  <>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("The download started automatically.", "Der Download wurde automatisch gestartet.")}
                    </p>
                    <a
                      href={result.url}
                      download={result.name}
                      className="mt-2 flex items-center gap-2 font-mono text-[11px] underline"
                    >
                      <Download className="size-3" /> {t("Save again", "Erneut speichern")}: {result.name}
                    </a>
                  </>
                ) : (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {t("Saved to the location you chose:", "Am gewählten Speicherort abgelegt:")} {result.name}
                  </p>
                )}
              </div>
            )}

            {result && clip && (
              clip.peakDb > 0 ? (
                <div className="mt-3 rounded-lg border border-accent/60 bg-accent/10 p-3 text-xs">
                  <TriangleAlert className="mr-2 inline size-4 text-accent" />
                  {t(
                    `Clipping detected: peak reached +${clip.peakDb.toFixed(1)} dBFS on ACN ${clip.channel}. The 24-bit output was limited.`,
                    `Übersteuerung erkannt: Spitzenwert +${clip.peakDb.toFixed(1)} dBFS auf ACN ${clip.channel}. Die 24-Bit-Ausgabe wurde beschnitten.`,
                  )}
                  <button
                    onClick={() => {
                      setGainDb(clip.suggestedGain);
                      setPendingRerender(true);
                    }}
                    disabled={rendering}
                    className="mt-2 w-full rounded-lg bg-foreground px-3 py-2 text-[11px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {t(
                      `Apply suggested gain (${clip.suggestedGain.toFixed(1)} dB) & re-render`,
                      `Vorgeschlagenen Gain (${clip.suggestedGain.toFixed(1)} dB) anwenden & neu rendern`,
                    )}
                  </button>
                </div>
              ) : (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {t("Peak", "Spitzenwert")}: {clip.peakDb === -Infinity ? "-∞" : clip.peakDb.toFixed(1)} dBFS ·{" "}
                  {t("clean headroom", "sauberer Headroom")}
                </p>
              )
            )}
          </Panel>


        </div>
      </div>

      <footer className="space-y-2 border-t border-border px-5 py-6 text-center text-[11px] text-muted-foreground">
        <p className="mx-auto max-w-2xl text-foreground/80">
          <ShieldCheck className="mr-1.5 inline size-3.5 text-[var(--v2-valid)]" />
          {t(
            "Your audio files never leave your computer. All parsing, spatial math and Ambisonic encoding happen directly on your CPU inside this browser tab. No files are uploaded to any server.",
            "Deine Audiodateien verlassen nie deinen Rechner. Das gesamte Parsing, die Raumberechnung und die Ambisonics-Kodierung laufen direkt auf deiner CPU in diesem Browser-Tab. Es werden keine Dateien auf einen Server hochgeladen.",
          )}
        </p>
        <p>
          {t(
            "AmbiX output: WAVE_FORMAT_EXTENSIBLE, 24-bit PCM, ACN order, SN3D normalization, RF64 promotion past 4 GB.",
            "AmbiX-Ausgabe: WAVE_FORMAT_EXTENSIBLE, 24-bit PCM, ACN-Reihenfolge, SN3D-Normalisierung, RF64 ab 4 GB.",
          )}
        </p>
        <p className="mx-auto max-w-3xl">
          {t(
            "AURA is an independent tool and is not affiliated with, endorsed by or certified by Dolby Laboratories, Inc. It reads the open Audio Definition Model (ITU-R BS.2076) metadata contained in the files you provide. Dolby, Dolby Atmos and the double-D symbol are trademarks of Dolby Laboratories, Inc.; all trademarks are used for identification purposes only.",
            "AURA ist ein unabhängiges Werkzeug und steht in keiner Verbindung zu Dolby Laboratories, Inc., wird von dort weder unterstützt noch zertifiziert. Es liest die offenen Audio-Definition-Model-Metadaten (ITU-R BS.2076) der von dir bereitgestellten Dateien. Dolby, Dolby Atmos und das Doppel-D-Symbol sind Marken von Dolby Laboratories, Inc.; alle Marken werden ausschließlich zu Identifikationszwecken genannt.",
          )}
        </p>
      </footer>
      <PrivacyDialog open={privacy.open} onOpenChange={privacy.setOpen} />
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
