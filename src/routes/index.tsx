import { createFileRoute } from "@tanstack/react-router";
import { BUILD_TIME } from "@/lib/build-time";
import {
  Activity,
  Boxes,
  CircleCheck,
  Download,
  Save,
  FileAudio,
  Info,
  ArrowUpRight,
  Layers,
  Play,
  ShieldCheck,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import kioLight from "@/assets/kio_logo_light.webp";
import kioDark from "@/assets/kio_logo_dark.png";
import auraLogoBlack from "@/assets/aura_logo_black.svg";
import auraLogoWhite from "@/assets/aura_logo_white.svg";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PrivacyDialog, usePrivacyDialog } from "@/components/PrivacyDialog";
import { useLang } from "@/lib/i18n";
import { ChannelMapEditor } from "@/components/adm/ChannelMapEditor";
import { MetadataInspector } from "@/components/adm/MetadataInspector";
import { Meters } from "@/components/adm/Meters";
import { SpatialViewer } from "@/components/adm/SpatialViewer";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { CLIPPING_HEADROOM_DB, suggestedMasterGain } from "@/engine/clipping";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { analyseAdm, mutedTracks, programmeFileTag, BED_ORDER, BED_PROFILES, defaultChannelMap } from "@/engine/adm";
import { parseContainer } from "@/engine/container";
import { channelCount } from "@/engine/sh";

import { ENVELOPE_BIN_SEC } from "@/engine/types";
import { peakWindows } from "@/engine/peak-windows";
import type {
  AnalysisResult,
  BedProfile,
  ContainerInfo,
  EnvelopeRequest,
  EnvelopeResponse,
  LevelState,
  LfeGain,
  LfeRouting,
  RenderSource,

  WorkerRequest,
  WorkerResponse,
} from "@/engine/types";
import { COMMON_CHANNELS, COMMON_PACKS } from "@/engine/common-definitions";


/** The 14 channels of ITU-R BS.2094 pack AP_00010008 (13.1, System G), ordered by layer. */
const ITU_13_1_ROWS = (() => {
  const layer = (label: string) =>
    label.startsWith("T") ? 0 : label.startsWith("U") ? 1 : label.startsWith("M") ? 2 : label.startsWith("B") ? 3 : 4;
  return (COMMON_PACKS["AP_00010008"]?.channels ?? [])
    .map((id) => COMMON_CHANNELS[id]!)
    .filter(Boolean)
    .sort((a, b) => layer(a.label) - layer(b.label) || Math.abs(a.azimuth) - Math.abs(b.azimuth) || b.azimuth - a.azimuth);
})();

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

/** dB readout that turns into a number field on click; clamps −24…+6, 0.1 dB steps. */
function GainReadout({
  value,
  disabled,
  onChange,
  title,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const clickTimer = useRef<number | null>(null);
  const commit = () => {
    const n = Number(draft.replace(",", ".").replace("−", "-"));
    if (draft.trim() !== "" && Number.isFinite(n)) {
      onChange(Math.round(Math.min(6, Math.max(-24, n)) * 10) / 10);
    }
    setEditing(false);
  };
  if (editing && !disabled) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px]">
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Master gain (dB)"
          className="w-14 rounded border border-border bg-background px-1 py-0.5 text-right"
        />
        dB
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        // wait briefly so a double-click resets instead of opening the field
        if (clickTimer.current) window.clearTimeout(clickTimer.current);
        clickTimer.current = window.setTimeout(() => {
          setDraft(value.toFixed(1));
          setEditing(true);
        }, 220);
      }}
      onDoubleClick={() => {
        if (clickTimer.current) window.clearTimeout(clickTimer.current);
        onChange(0);
      }}
      title={title}
      className="cursor-text select-none rounded px-1 font-mono text-[10px] hover:bg-secondary disabled:cursor-default disabled:opacity-60"
    >
      {value.toFixed(1)} dB
    </button>
  );
}

type Order = (typeof ORDERS)[number];

const LFE_ROUTINGS: [LfeRouting, string, string, string, string][] = [
  ["omni", "Omnidirectional", "Omnidirektional", "W only", "nur W"],
  ["down", "Lower hemisphere", "Untere Hemisphäre", "cardioid ↓ (W − Z)", "Niere ↓ (W − Z)"],
  ["position", "Speaker position", "Lautsprecher-Position", "encoded", "kodiert"],
  ["off", "Off", "Aus", "LFE excluded", "LFE ausgeschlossen"],
];

const LFE_GAINS: [LfeGain, string, string, string][] = [
  ["minus3", "−3 dB", "constant power", "konstante Schallleistung"],
  ["unity", "0 dB", "unity", "Unity"],
  ["plus10", "+10 dB", "Dolby sub calibration", "Dolby-Sub-Kalibrierung"],
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

/** Above this size the finished file waits for a real click (Safari crashes on a scripted one). */
const DIAG_KEY = "aura-crash-diag";
function diagStep(step: string) {
  try {
    const prev = localStorage.getItem(DIAG_KEY) ?? "";
    localStorage.setItem(DIAG_KEY, `${prev}${new Date().toISOString().slice(11, 19)} ${step}\n`);
  } catch { /* storage full */ }
}
function diagClear() {
  try { localStorage.removeItem(DIAG_KEY); } catch { /* ignore */ }
}
const AUTO_DOWNLOAD_MAX_BYTES = 1024 ** 3;

function Workstation() {
  const { t, lang, setLang } = useLang();
  const privacy = usePrivacyDialog();
  const [file, setFile] = useState<File | null>(null);
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [profile, setProfile] = useState<BedProfile>("dolby");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  /** chosen audioProgramme; only meaningful when the file has 2+ programmes */
  const [programmeId, setProgrammeId] = useState<string | null>(null);
  const muted = useMemo(
    () => mutedTracks(analysis?.programmes ?? [], programmeId),
    [analysis, programmeId],
  );
  /** sources of the selected programme; identical to analysis.sources for single-programme files */
  const activeSources = useMemo<RenderSource[]>(
    () => (!analysis ? [] : muted.size === 0 ? analysis.sources : analysis.sources.filter((s) => !muted.has(s.channelIndex))),
    [analysis, muted],
  );
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [order, setOrder] = useState<Order>(3);
  const [lfeRouting, setLfeRouting] = useState<LfeRouting>("omni");
  const [lfeGain, setLfeGain] = useState<LfeGain>("minus3");

  const [gainDb, setGainDb] = useState(0);
  /** On-demand peak pre-scan, measured at 0 dB master gain (encoding is linear). */
  const [preScan, setPreScan] = useState<{ progress: number } | null>(null);
  /** Scan result per order tier [ACN 0–15, 16–35, 36–63], linear, at 0 dB master gain. */
  const [groupPeaks, setGroupPeaks] = useState<Float32Array | null>(null);
  const scanWorkerRef = useRef<Worker | null>(null);

  const [rendering, setRendering] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausedClip, setPausedClip] = useState<{ peakDb: number; channel: number; suggestedGain: number } | null>(null);
  const [framesDone, setFramesDone] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ url: string; name: string; auto?: boolean } | null>(null);
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

  /** level data the spatial viewer reads every frame (scanned or live) */
  const levelsRef = useRef<LevelState>({
    channels: 0,
    binSamples: 1,
    bins: 0,
    envelope: null,
    live: null,
  });
  const envWorkerRef = useRef<Worker | null>(null);
  const [scanPct, setScanPct] = useState(0);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      envWorkerRef.current?.terminate();
    },
    [],
  );

  // Background level scan: one pass over the file, reduced to 50 ms peak bins.
  useEffect(() => {
    envWorkerRef.current?.terminate();
    envWorkerRef.current = null;
    if (!file || !container) {
      levelsRef.current = { channels: 0, binSamples: 1, bins: 0, envelope: null, live: null };
      setScanPct(0);
      return;
    }
    const rate = container.format.sampleRate;
    const binSamples = Math.max(1, Math.round(rate * ENVELOPE_BIN_SEC));
    const bins = Math.max(1, Math.ceil(container.frameCount / binSamples));
    const channels = container.format.channels;
    levelsRef.current = {
      channels,
      binSamples,
      bins,
      envelope: new Float32Array(channels * bins),
      low: new Float32Array(channels * bins),
      live: null,
    };
    setScanPct(0);

    const w = new Worker(new URL("../engine/envelope.worker.ts", import.meta.url), {
      type: "module",
    });
    envWorkerRef.current = w;
    w.onmessage = (ev: MessageEvent<EnvelopeResponse>) => {
      const msg = ev.data;
      if (msg.type === "bins") {
        const env = levelsRef.current.envelope;
        const low = levelsRef.current.low;
        if (!env) return;
        for (let b = 0; b < msg.count; b++) {
          const bin = msg.startBin + b;
          if (bin >= bins) break;
          for (let c = 0; c < msg.channels; c++) {
            env[c * bins + bin] = msg.data[b * msg.channels + c]!;
            if (low) low[c * bins + bin] = msg.low[b * msg.channels + c]!;
          }
        }
        setScanPct(Math.min(1, (msg.startBin + msg.count) / bins));
      } else if (msg.type === "done") {
        setScanPct(1);
        w.terminate();
        envWorkerRef.current = null;
      } else {
        w.terminate();
        envWorkerRef.current = null;
      }
    };
    const req: EnvelopeRequest = {
      type: "scan",
      file,
      container: {
        dataOffset: container.dataOffset,
        frameCount: container.frameCount,
        blockAlign: container.format.blockAlign,
        bitsPerSample: container.format.bitsPerSample,
        isFloat: container.format.formatTag === 3,
        channels: container.format.channels,
        sampleRate: rate,
      },
      binSamples,
    };
    w.postMessage(req);
    return () => {
      w.terminate();
      if (envWorkerRef.current === w) envWorkerRef.current = null;
    };
  }, [file, container]);


  // Idle animation runs inside SpatialViewer; only the time readout is refreshed here, a few times per second.
  const viewerHeadRef = useRef(0);
  useEffect(() => {
    if (!analysis || rendering) return;
    const id = window.setInterval(() => setPlayhead(viewerHeadRef.current), 250);
    return () => window.clearInterval(id);
  }, [analysis, rendering]);

  // Crash flight recorder: steps survive a Safari tab kill in localStorage.
  const [crashDiag, setCrashDiag] = useState<string | null>(null);
  useEffect(() => {
    const v = localStorage.getItem(DIAG_KEY);
    if (v) setCrashDiag(`${navigator.userAgent}\n${v}`);
  }, []);

  const loadFile = useCallback(
    async (f: File) => {
      // Always start clean: stop any render (running or paused on clipping).
      workerRef.current?.terminate();
      workerRef.current = null;
      setRendering(false);
      setStopping(false);
      setError(null);
      setAnalysis(null);
      setProgrammeId(null);
      setContainer(null);
      setResult(null);
      setChannelMap(null);
      setGainDb(0);
      setGroupPeaks(null);
      // A new file starts from a clean idle state: no meters, progress or peaks from the last render.
      scanWorkerRef.current?.terminate();
      scanWorkerRef.current = null;
      setPreScan(null);
      setPeaks(null);
      setFramesDone(0);
      setBytesWritten(0);
      setElapsed(0);
      setClip(null);
      setPausedClip(null);
      setPlayhead(0);
      viewerHeadRef.current = 0;
      levelsRef.current.live = null;
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

  // Full-window drop target: files dropped anywhere load as the source.
  const [windowDrag, setWindowDrag] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setWindowDrag(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = rendering ? "none" : "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setWindowDrag(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setWindowDrag(false);
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f && !rendering) void loadFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [loadFile, rendering]);

  useEffect(() => {
    if (!container) return;
    try {
      setAnalysis(analyseAdm(container, profile, channelMap ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [container, profile, channelMap]);




  // Any setting that changes the encoded signal invalidates a previous scan.
  // The order does not: one 7th-order scan covers 3rd and 5th order too.
  useEffect(() => {
    setGroupPeaks(null);
    scanWorkerRef.current?.terminate();
    scanWorkerRef.current = null;
    setPreScan(null);
  }, [analysis, lfeRouting, lfeGain, programmeId]);

  const startPeakScan = useCallback(() => {
    if (!analysis || !file || scanWorkerRef.current) return;
    const lv = levelsRef.current;
    if (!lv.envelope) return;
    // Encode a 500 ms window (±250 ms) around each used channel's loudest moment.
    const used = new Set(
      activeSources
        .filter((s) => !(s.isLFE && lfeRouting === "off") && s.channelIndex >= 0)
        .map((s) => s.channelIndex),
    );
    // LFE channels pick their loudest moment *after* the 120 Hz low-pass,
    // otherwise speech or bleed on the LFE track wins and the sub peak is missed.
    const lfeChannels = new Set(
      activeSources.filter((s) => s.isLFE && lfeRouting !== "off" && s.channelIndex >= 0).map((s) => s.channelIndex),
    );
    const windows = peakWindows(
      lv.envelope, lv.bins, lv.binSamples, used,
      Math.round(analysis.container.format.sampleRate * 0.25),
      analysis.container.frameCount,
      lv.low ? { envelope: lv.low, channels: lfeChannels } : undefined,
    );
    const worker = new Worker(new URL("../engine/render.worker.ts", import.meta.url), { type: "module" });
    scanWorkerRef.current = worker;
    setPreScan({ progress: 0 });
    setGroupPeaks(null);
    const finish = () => {
      worker.terminate();
      if (scanWorkerRef.current === worker) scanWorkerRef.current = null;
      setPreScan(null);
    };
    worker.onerror = (ev) => { setError(`Peak scan failed: ${ev.message || "unknown error"}`); finish(); };
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") setPreScan({ progress: msg.framesDone / Math.max(1, msg.totalFrames) });
      else if (msg.type === "done") {
        setGroupPeaks(new Float32Array(msg.groupPeaks));
        finish();
      } else if (msg.type === "error") { setError(msg.message); finish(); }
      else if (msg.type === "cancelled") finish();
    };
    const req: WorkerRequest = {
      type: "render",
      file,
      sources: activeSources,
      container: {
        dataOffset: analysis.container.dataOffset,
        frameCount: analysis.container.frameCount,
        blockAlign: analysis.container.format.blockAlign,
        bitsPerSample: analysis.container.format.bitsPerSample,
        isFloat: analysis.container.format.formatTag === 3,
        channels: analysis.container.format.channels,
        sampleRate: analysis.container.format.sampleRate,
      },
      // Scan once at 7th order; lower orders are the leading ACN channels.
      config: { order: 7, lfeRouting, lfeGain, masterGain: 1 },
      handle: null,
      scanOnly: true,
      windows,
    };
    worker.postMessage(req);
  }, [analysis, activeSources, file, lfeRouting, lfeGain]);

  const cancelPeakScan = () => {
    scanWorkerRef.current?.terminate();
    scanWorkerRef.current = null;
    setPreScan(null);
  };

  const basePeak = groupPeaks === null ? null : Math.max(...Array.from(groupPeaks.subarray(0, order === 3 ? 1 : order === 5 ? 2 : 3)));
  const predictedPeakDb = basePeak === null ? null : (basePeak > 0 ? 20 * Math.log10(basePeak) : -Infinity) + gainDb;

  const startRender = useCallback(async () => {
    if (!file || !analysis) return;
    setError(null);
    setResult(null);
    setFramesDone(0);
    setBytesWritten(0);
    diagClear();
    setCrashDiag(null);
    diagStep(`main: render started, ${(file.size / 1e9).toFixed(2)} GB input`);

    setClip(null);
    setPausedClip(null);
    setStopping(false);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const hasLfe = activeSources.some((s) => s.isLFE);
    const routeTag =
      lfeRouting === "omni" ? "omni" : lfeRouting === "down" ? "down" : "pos";
    const levelTag = lfeGain === "minus3" ? "-3dB" : lfeGain === "unity" ? "0dB" : "+10dB";
    const lfeTag = !hasLfe ? "" : lfeRouting === "off" ? "_noLFE" : `_LFE${routeTag}${levelTag}`;
    // Only tag the gain when it differs from unity.
    const gainTag =
      gainDb === 0
        ? ""
        : `_gain${gainDb > 0 ? "+" : "-"}${Math.abs(gainDb).toFixed(1).replace(/\.0$/, "")}dB`;
    // Dolby is the default geometry, so only ITU renders carry a profile tag.
    const profileTag = profile === "itu" ? "_ITU" : "";
    const progTag = programmeFileTag(analysis.programmes, programmeId);
    const outName = `${baseName}${progTag}_AmbiX_${order}OA${lfeTag}${gainTag}${profileTag}_AURA.wav`;


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

    // The render reads every sample anyway, so the background scan stands down.
    envWorkerRef.current?.terminate();
    envWorkerRef.current = null;

    const worker = new Worker(new URL("../engine/render.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setRendering(true);

    worker.onerror = (ev) => {
      setError(`Render worker failed: ${ev.message || "unknown error"}`);
      setRendering(false);
      setPausedClip(null);
      setStopping(false);
      worker.terminate();
      workerRef.current = null;
      levelsRef.current.live = null;
    };

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "clipping") {
        const peakDb = 20 * Math.log10(msg.maxPeak);
        setPausedClip({ peakDb, channel: msg.maxPeakChannel, suggestedGain: suggestedMasterGain(gainDb, peakDb) });
        setFramesDone(msg.framesDone);
        setBytesWritten(msg.bytesWritten);
        setElapsed(msg.elapsedMs);
      } else if (msg.type === "cancelled") {
        setRendering(false);
        setStopping(false);
        setPausedClip(null);
        // Stopped renders return to a clean idle state: no frozen meters or progress.
        setFramesDone(0);
        setBytesWritten(0);
        setElapsed(0);
        setPeaks(null);
        levelsRef.current.live = null;
        worker.terminate();
        workerRef.current = null;
      } else if ((msg as { type: string }).type === "diag") {
        diagStep((msg as unknown as { step: string }).step);
      } else if (msg.type === "progress") {
        setFramesDone(msg.framesDone);
        setPeaks(msg.peaks);
        setBytesWritten(msg.bytesWritten);
        setElapsed(msg.elapsedMs);
        setPlayhead(msg.framesDone);
        levelsRef.current.live = msg.sourcePeaks;
      } else if (msg.type === "done") {
        setRendering(false);
        // Finished renders return the output meters to idle instead of freezing on the last block.
        setPeaks(null);
        setBytesWritten(msg.bytesWritten);
        setElapsed(msg.elapsedMs);
        // Full envelope comes back from the render for free.
        levelsRef.current.live = null;
        if (msg.envelope) {
          // Merge only channels this render actually metered; the render skips
          // muted programme tracks, so replacing the scan would zero them out.
          const prev = levelsRef.current;
          const merged =
            prev.envelope && prev.bins === msg.envelopeBins && prev.binSamples === msg.binSamples
              ? new Float32Array(prev.envelope)
              : new Float32Array(msg.envelope.length);
          const bins = msg.envelopeBins;
          for (const ci of new Set(activeSources.map((s) => s.channelIndex))) {
            if (ci < 0) continue;
            merged.set(msg.envelope.subarray(ci * bins, (ci + 1) * bins), ci * bins);
          }
          levelsRef.current = {
            channels: levelsRef.current.channels,
            binSamples: msg.binSamples,
            bins: msg.envelopeBins,
            envelope: merged,
            // Keep the low-passed scan: the render envelope is unfiltered.
            low: levelsRef.current.low ?? null,
            live: null,
          };
          setScanPct(1);
        }
        // Peak is measured in 32-bit float before 24-bit quantisation clamps it.
        const peakDb = msg.maxPeak > 0 ? 20 * Math.log10(msg.maxPeak) : -Infinity;
        const suggested = suggestedMasterGain(gainDb, peakDb);
        setClip({ peakDb, channel: msg.maxPeakChannel, suggestedGain: suggested });

        diagStep(`main: done received, blob ${msg.blob ? (msg.blob.size / 1e9).toFixed(2) + " GB" : "none"}`);
        const url = msg.blob ? URL.createObjectURL(msg.blob) : "";
        diagStep("main: createObjectURL ok");
        // Large files skip the automatic download: Safari turns a late
        // scripted click on a multi-GB file into a page crash, while a real
        // click on the button below downloads it cleanly.
        const auto = !!url && (msg.blob?.size ?? 0) < AUTO_DOWNLOAD_MAX_BYTES;
        setResult({ url, name: outName, auto });
        if (auto) {
          // Start the download right away so the file lands in Downloads.
          const a = document.createElement("a");
          a.href = url;
          a.download = outName;
          a.rel = "noopener";
          document.body.appendChild(a);
          diagStep("main: auto-click");
          a.click();
          a.remove();
        }
        diagStep("main: result shown");
        diagClear();
        worker.terminate();
        workerRef.current = null;
      } else {
        diagClear();
        setError(msg.message);
        setRendering(false);
        setStopping(false);
        setPausedClip(null);
        levelsRef.current.live = null;
        worker.terminate();
        workerRef.current = null;
      }
    };

    const req: WorkerRequest = {
      type: "render",
      file,
      sources: activeSources,
      container: {
        dataOffset: analysis.container.dataOffset,
        frameCount: analysis.container.frameCount,
        blockAlign: analysis.container.format.blockAlign,
        bitsPerSample: analysis.container.format.bitsPerSample,
        isFloat: analysis.container.format.formatTag === 3,
        channels: analysis.container.format.channels,
        sampleRate: analysis.container.format.sampleRate,
      },
      config: { order, lfeRouting, lfeGain, masterGain: Math.pow(10, gainDb / 20) },
      handle,
    };
    worker.postMessage(req);
  }, [analysis, activeSources, programmeId, file, gainDb, lfeRouting, lfeGain, order, outChannels, profile]);


  const stopRender = () => {
    if (!workerRef.current) return;
    setStopping(true);
    workerRef.current.postMessage({ type: "cancel" });
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
  const beds = useMemo(() => activeSources.filter((s) => s.kind === "bed"), [activeSources]);
  const objects = useMemo(
    () => activeSources.filter((s) => s.kind === "object"),
    [activeSources],
  );

  return (
    <div className="v2-theme min-h-screen">
      {windowDrag && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[var(--v2-valid)] bg-card px-10 py-8 text-center shadow-lg">
            <FileAudio className="mx-auto mb-3 size-8 text-[var(--v2-valid)]" />
            <p className="text-base font-medium">
              {rendering
                ? t("Rendering in progress — wait until it finishes", "Rendering läuft — bitte warten, bis es fertig ist")
                : t("Drop to load as source", "Ablegen, um als Quelle zu laden")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">BWF · RF64 · BW64 · WAV</p>
          </div>
        </div>
      )}
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex flex-col items-start gap-1">
            <img src={auraLogoBlack} alt="AURA" className="h-[42px] w-auto dark:hidden" />
            <img src={auraLogoWhite} alt="AURA" className="hidden h-[42px] w-auto dark:block" />
            <span className="font-kio hidden text-[11px] tracking-[0.02em] text-muted-foreground sm:block">
              ADM Universal Renderer into Ambisonics
            </span>
          </div>

          {crashDiag && (
            <div className="w-full rounded-lg border border-destructive bg-destructive/10 p-3 font-mono text-[11px] text-destructive">
              <div className="mb-1 flex items-center justify-between font-sans font-semibold">
                <span>{t("Previous render crashed. Last steps:", "Letzter Render ist abgestürzt. Letzte Schritte:")}</span>
                <button type="button" className="underline" onClick={() => { navigator.clipboard?.writeText(crashDiag); }}>{t("Copy", "Kopieren")}</button>
              </div>
              <pre className="whitespace-pre-wrap">{crashDiag}</pre>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => privacy.setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ShieldCheck className="size-3.5 text-[var(--spatial-obj)]" />
              {t("100% Offline", "100% offline")}
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
              {(["dolby", "itu"] as BedProfile[]).map((p) => {
                const active = profile === p;
                const name = p === "dolby" ? t("Dolby mode", "Dolby-Modus") : t("ITU mode", "ITU-Modus");
                return (
                  <div
                    key={p}
                    className={`inline-flex items-center rounded-full transition-colors ${
                      active ? "bg-foreground text-background" : "text-muted-foreground"
                    } ${rendering ? "opacity-40" : ""}`}
                  >
                    <button
                      onClick={() => setProfile(p)}
                      disabled={rendering}
                      className={`rounded-full py-1 pl-3 pr-1 text-[11px] ${active ? "font-semibold" : "hover:text-foreground"}`}
                    >
                      {name}
                    </button>
                    <Popover>
                      <PopoverTrigger
                        aria-label={t(`About ${name}`, `Über ${name}`)}
                        className={`mr-1 inline-flex size-4 items-center justify-center rounded-full ${
                          active ? "opacity-80 hover:opacity-100" : "hover:text-foreground"
                        }`}
                      >
                        <Info className="size-3" />
                      </PopoverTrigger>
                      <PopoverContent align="end" className="v2-theme w-64 rounded-xl p-3 text-xs leading-relaxed">
                        <span className="font-semibold">{name}: </span>
                        {p === "dolby"
                          ? t("Maps room coordinates to standard Dolby speaker positions (matching Dolby Atmos Renderer exports).", "Mappt Raumkoordinaten auf Standard-Dolby-Lautsprecherpositionen (abgestimmt auf Dolby Atmos Renderer-Exporte).")
                          : t("Direct spherical projection conforming to ITU-R BS.2076 / BS.2127.", "Direkte sphärische Projektion gemäß ITU-R BS.2076 / BS.2127.")}
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })}
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
                  accept=".wav,.wave,.bwf,.rf64,.bw64,audio/wav,audio/x-wav,audio/vnd.wave"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    // Clear so picking the same file again still fires onChange.
                    e.target.value = "";
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
                {t("Scanning container…", "Container wird analysiert…")}
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
                {analysis.programmeName && analysis.programmes.length <= 1 && (
                  <Row k={t("Programme", "Programm")} v={analysis.programmeName} />
                )}
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



{profile === "itu" ? (
          <Panel title={t("13.1 bed reference (ITU-R BS.2051)", "13.1-Bed-Referenz (ITU-R BS.2051)")} icon={<Layers className="size-3.5" />}>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "In ITU-R BS.2051, the largest bed with a single LFE is 13.1 (System G) — these 14 speaker positions across two layers. Dynamic objects and custom layouts are placed from their own coordinates. Explicit coordinates in the file always override this table.",
                "In ITU-R BS.2051 ist 13.1 (System G) das größte Bed mit einem LFE — diese 14 Lautsprecherpositionen über zwei Ebenen. Dynamische Objekte und individuelle Layouts werden nach ihren eigenen Koordinaten platziert. Explizite Koordinaten in der Datei überschreiben stets diese Tabelle.",
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <tbody>
                  {ITU_13_1_ROWS.map((c) => (
                    <tr key={c.id} className="border-b border-border/60 last:border-0">
                      <td className="py-1 pr-2 text-foreground">{c.label}</td>
                      <td className="py-1 text-right text-muted-foreground">
                        {c.label === "LFE" ? "omni → W" : `${c.azimuth}° / ${c.elevation}°`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          ) : (
                    <Panel title={t("7.1.2 bed reference", "7.1.2-Bed-Referenz")} icon={<Layers className="size-3.5" />}>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "A Dolby Atmos bed is at most 7.1.2 — these ten channels. Wides and additional height positions arrive as dynamic objects and are placed from their own coordinates. Explicit coordinates in the file always override this table.",
                "Ein Dolby-Atmos-Bed umfasst höchstens 7.1.2 — diese zehn Kanäle. Wide- und zusätzliche Höhenpositionen kommen als dynamische Objekte und werden nach ihren eigenen Koordinaten platziert. Explizite Koordinaten in der Datei überschreiben stets diese Tabelle.",
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
          )}

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
            title={t("Object paths", "Objektpfade")}
            icon={<Boxes className="size-3.5" />}
            right={
              analysis ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {scanPct > 0 && scanPct < 1 && !rendering && (
                    <span className="mr-2 text-accent">
                      {t("levels", "Pegel")} {Math.round(scanPct * 100)}%
                    </span>
                  )}
                  {fmtTime(playhead / analysis.container.format.sampleRate)} /{" "}
                  {fmtTime(analysis.container.durationSec)}
                </span>
              ) : null
            }
          >
            {analysis ? (
              <>
                <SpatialViewer
                  sources={activeSources}
                  frameCount={analysis.container.frameCount}
                  sampleRate={analysis.container.format.sampleRate}
                  playheadSample={playhead}
                  followPlayhead={rendering}
                  playheadOutRef={viewerHeadRef}
                  levelsRef={levelsRef}
                  lfeRouting={lfeRouting}
                />


                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t("Squares are bed anchors, dots are objects on their interpolated paths. Drag to rotate.", "Quadrate sind Bed-Anker, Punkte sind Objekte auf ihren Objektpfaden. Zum Drehen ziehen.")}
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

          {analysis && (
            <MetadataInspector
              analysis={analysis}
              lfeRouting={lfeRouting}
              muted={muted}
              header={
                analysis.programmes.length > 1 ? (
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-muted-foreground">
                  {t("Programme", "Programm")} · {analysis.programmes.length} {t("versions in this file", "Fassungen in dieser Datei")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.programmes.map((p, i) => {
                    const active = (programmeId ?? analysis.programmes[0]!.id) === p.id;
                    return (
                      <button
                        key={`${p.id}-${i}`}
                        onClick={() => { setProgrammeId(p.id); setGroupPeaks(null); }}
                        disabled={rendering}
                        className={`rounded-full border px-3 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                          active ? "border-foreground bg-foreground font-semibold text-background" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {p.name}{p.language ? ` (${p.language})` : ""}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("Only the selected version is rendered; tracks of the other versions are muted.", "Nur die gewählte Fassung wird gerendert; Spuren der anderen Fassungen sind stummgeschaltet.")}
                </p>
              </div>
                ) : undefined
              }
            />
          )}
          {!analysis && (
            <Panel title={t("Track & Source Inspector", "Spur- & Quell-Inspektor")}>
              <Empty label={t("Chunk map, reference chains and raw axml appear here after loading.", "Chunk-Übersicht, Referenzketten und rohes axml erscheinen hier nach dem Laden.")} />
            </Panel>
          )}
        </div>

        {/* ─────────── COLUMN 3 · OUTPUT ─────────── */}
        <div className="space-y-4">
          <Panel
            title={t("Ambisonic order", "Ambisonics-Ordnung")}
            icon={<Layers className="size-3.5" />}
            right={
              <span className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 font-mono text-[10px] text-muted-foreground">
                ACN · SN3D · AmbiX
                <Popover>
                  <PopoverTrigger
                    aria-label={t("About ACN · SN3D · AmbiX", "Über ACN · SN3D · AmbiX")}
                    className="inline-flex size-4 items-center justify-center rounded-full hover:text-foreground"
                  >
                    <Info className="size-3" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="v2-theme w-64 rounded-xl p-3 font-sans text-xs leading-relaxed">
                    <p>
                      <span className="font-semibold">AmbiX: </span>
                      {t("Quasi-standard exchange format for Higher Order Ambisonics in DAWs and spatial tools.", "Quasi-Standard-Austauschformat für Higher Order Ambisonics in DAWs und Spatial-Tools.")}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">ACN: </span>
                      {t("Channel order starting from 0 (W = 0, followed by Y, Z, X…).", "Kanalreihenfolge ab 0 (W = 0, gefolgt von Y, Z, X…).")}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">SN3D: </span>
                      {t("Semi-normalisation for balanced directional energy.", "Semi-Normalisierung für ausgewogene Richtungsenergie.")}
                    </p>
                  </PopoverContent>
                </Popover>
              </span>
            }
          >

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

          <Panel title={t("LFE Channel Treatment", "Behandlung des LFE-Kanals")}>
            <div className="flex flex-wrap gap-2">
              {LFE_ROUTINGS.map(([mode, labelEn, labelDe, hintEn, hintDe]) => (
                <Pill
                  key={mode}
                  active={lfeRouting === mode}
                  disabled={rendering}
                  onClick={() => {
                    setLfeRouting(mode);
                    if (mode === "omni") setLfeGain("minus3");
                    else if (mode !== "off") setLfeGain("unity");
                  }}
                >
                  {t(labelEn, labelDe)}
                  <span className="ml-1.5 font-mono text-[9px] opacity-60">{t(hintEn, hintDe)}</span>
                </Pill>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {lfeRouting === "omni" &&
                t(
                  "The LFE channel is filtered at 120 Hz (4th-order Butterworth) and summed into ACN 0 (W) only — equal pressure in every direction. Best for headphone binauralisation and neutral distribution.",
                  "Der LFE-Kanal wird bei 120 Hz gefiltert (Butterworth 4. Ordnung) und nur in ACN 0 (W) eingespeist — gleichmäßiger Schalldruck in alle Richtungen. Ideal für Kopfhörer-Binauralisierung und neutrale Wiedergabe.",
                )}
              {lfeRouting === "down" &&
                t(
                  "The LFE channel is filtered at 120 Hz and encoded as a cardioid into the lower hemisphere (W − Z). Best for loudspeaker setups, keeping sub energy out of height speakers.",
                  "Der LFE-Kanal wird bei 120 Hz gefiltert und als Niere in die untere Hemisphäre (W − Z) kodiert. Ideal für Lautsprecher-Setups, da Deckenlautsprecher frei von Subbass bleiben.",
                )}
              {lfeRouting === "position" &&
                t(
                  `The LFE channel is filtered at 120 Hz and encoded at the LFE loudspeaker coordinates of the active profile (${profile === "itu" ? "ITU-R BS.2051 catalogue angles" : "0° azimuth, −30° elevation"}). Best for room and cinema simulations.`,
                  `Der LFE-Kanal wird bei 120 Hz gefiltert und an den LFE-Lautsprecherkoordinaten des aktiven Profils kodiert (${profile === "itu" ? "ITU-R-BS.2051-Katalogwinkel" : "0° Azimut, −30° Elevation"}). Ideal für Raum- und Kinosimulationen.`,
                )}
              {lfeRouting === "off" &&
                t(
                  "The LFE channel is excluded from the render. Sensible when bed and objects already carry enough low end, or to keep maximum headroom.",
                  "Der LFE-Kanal wird nicht gerendert. Sinnvoll, wenn Bed und Objekte bereits genug Tiefbass liefern oder für maximalen Headroom.",
                )}
            </p>

          </Panel>

          {lfeRouting !== "off" && (
            <Panel title={t("LFE level", "LFE-Pegel")}>
              <div className="flex flex-wrap gap-2">
                {LFE_GAINS.map(([g, label, hintEn, hintDe]) => (
                  <Pill key={g} active={lfeGain === g} disabled={rendering} onClick={() => setLfeGain(g)}>
                    {label}
                    <span className="ml-1.5 font-mono text-[9px] opacity-60">{t(hintEn, hintDe)}</span>
                  </Pill>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title={t("Master gain", "Master Gain")}
            right={
              <GainReadout
                value={gainDb}
                disabled={rendering}
                onChange={setGainDb}
                title={t("Click to type a value · double-click resets to 0 dB", "Klicken für Zahleneingabe · Doppelklick setzt auf 0 dB zurück")}
              />
            }
          >
            <input
              type="range"
              min={-24}
              max={6}
              step={0.5}
              value={gainDb}
              disabled={rendering}
              onChange={(e) => setGainDb(Number(e.target.value))}
              onDoubleClick={() => !rendering && setGainDb(0)}
              title={t("Double-click to reset to 0 dB", "Doppelklick setzt auf 0 dB zurück")}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[var(--v2-valid)]"
            />
            <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
              {preScan ? (
                <div className="flex items-center gap-2">
                  <Progress value={preScan.progress * 100} className="h-1.5 flex-1" />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {t("Analysing…", "Analysiere…")} {Math.round(preScan.progress * 100)}%
                  </span>
                  <Button size="sm" variant="ghost" onClick={cancelPeakScan}>{t("Cancel", "Abbrechen")}</Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full rounded-full"
                  disabled={!analysis || !file || rendering || scanPct < 1}
                  onClick={startPeakScan}
                >
                  {scanPct < 1
                    ? t("Waiting for level scan…", "Warte auf Pegelscan…")
                    : t("Estimate max peak", "Maximalen Peak schätzen")}
                </Button>
              )}
              {predictedPeakDb !== null && !preScan && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`font-mono ${predictedPeakDb > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {t(`Estimated max peak (${order}OA · ${outChannels} ch)`, `Geschätzter max. Peak (${order}OA · ${outChannels} Kanäle)`)}: {Number.isFinite(predictedPeakDb) ? `${predictedPeakDb > 0 ? "+" : ""}${predictedPeakDb.toFixed(1)} dBFS` : "−∞ dBFS"}
                    {" · "}
                    {predictedPeakDb > 0 ? t("exceeds full scale", "übersteuert") : t("headroom OK", "Headroom OK")}
                  </span>
                  {predictedPeakDb > 0 && (
                    <Button
                      size="sm"
                      className="h-7 rounded-full px-3 text-[11px]"
                      disabled={rendering}
                      onClick={() => setGainDb(suggestedMasterGain(gainDb, predictedPeakDb))}
                    >
                      {t(
                        `Set Master Gain to ${suggestedMasterGain(gainDb, predictedPeakDb).toFixed(1)} dB`,
                        `Master Gain auf ${suggestedMasterGain(gainDb, predictedPeakDb).toFixed(1)} dB setzen`,
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Panel>


          <Panel
            title={t("Render & export", "Rendern & Export")}
            icon={<Download className="size-3.5" />}
            right={
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                24b · WAV · {t("Dithered", "Gedithert")}
              </span>
            }
          >
            {!rendering ? (
              <button
                onClick={() => void startRender()}
                disabled={!analysis}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Play className="size-4" /> {t(`Render ${outChannels}-ch AmbiX`, `${outChannels}-Kanal-AmbiX rendern`)}
              </button>
            ) : (
              <Button
                onClick={stopRender}
                disabled={stopping}
                variant="destructive"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                <Square className="size-4" /> {stopping ? t("Stopping…", "Wird gestoppt…") : t("Stop", "Stopp")}
              </Button>
            )}

            {(rendering || pausedClip) && (
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
            )}

            {pausedClip && <p role="status" className="mt-2 text-xs text-destructive">{t("Paused — clipping detected", "Pausiert — Übersteuerung erkannt")}</p>}

            {result && (
              <div className="mt-3 min-w-0 overflow-hidden rounded-lg border border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 p-3 text-xs">
                <CircleCheck className="mr-2 inline size-4 text-[var(--v2-valid)]" />
                {t(`Rendered ${fmtBytes(bytesWritten)} in ${(elapsed / 1000).toFixed(1)} s.`, `${fmtBytes(bytesWritten)} in ${(elapsed / 1000).toFixed(1)} s gerendert.`)}
                {clip && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {t("Sample peak", "Sample-Peak")}:{" "}
                    {clip.peakDb === -Infinity ? "-∞" : `${clip.peakDb > 0 ? "+" : ""}${clip.peakDb.toFixed(1)}`} dBFS
                  </p>
                )}

                {result.url ? (
                  <>
                    {result.auto ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("The file was saved automatically.", "Die Datei wurde automatisch gespeichert.")}
                    </p>
                    ) : (
                    <a
                      href={result.url}
                      download={result.name}
                      className="mt-2 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background"
                    >
                      <Save className="size-3.5" /> {t(`Save file (${fmtBytes(bytesWritten)})`, `Datei speichern (${fmtBytes(bytesWritten)})`)}
                    </a>
                    )}
                    {result.auto && <a
                      href={result.url}
                      download={result.name}
                      className="mt-2 flex items-start gap-2 break-all font-mono text-[11px] underline"
                    >
                      <Save className="mt-0.5 size-3 shrink-0" /> <span className="min-w-0">{t("Save again", "Erneut speichern")}: {result.name}</span>
                    </a>}
                  </>
                ) : (
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
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
                    `Clipping detected: peak reached +${clip.peakDb.toFixed(1)} dBFS on ACN ${clip.channel}. The 24-bit output was hard-clipped (no limiter applied).`,
                    `Übersteuerung erkannt: Spitzenwert +${clip.peakDb.toFixed(1)} dBFS auf ACN ${clip.channel}. Die 24-Bit-Ausgabe wurde hart begrenzt (kein Limiter aktiv).`,
                  )}
                  <p className="mt-2 text-muted-foreground">{t(
                    `Suggested gain includes ${CLIPPING_HEADROOM_DB} dB extra headroom (subject to the −24 dB gain limit).`,
                    `Der vorgeschlagene Gain enthält ${CLIPPING_HEADROOM_DB} dB zusätzlichen Headroom (bis zur Gain-Grenze von −24 dB).`,
                  )}</p>
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

      <AlertDialog open={pausedClip !== null}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <AlertDialogTitle className="flex items-center gap-2"><TriangleAlert className="size-5 text-destructive" />{t("Clipping detected — render paused", "Übersteuerung erkannt — Rendern pausiert")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              `Sample peak so far: +${pausedClip?.peakDb.toFixed(1)} dBFS on ACN ${pausedClip?.channel}. No limiter is active.`,
              `Bisheriger Sample-Peak: +${pausedClip?.peakDb.toFixed(1)} dBFS auf ACN ${pausedClip?.channel}. Kein Limiter aktiv.`,
            )}
          </AlertDialogDescription>
          <p className="text-sm text-muted-foreground">{t(
            `The suggested Master Gain includes ${CLIPPING_HEADROOM_DB} dB extra headroom. Later peaks may still be higher; a new render will pause again if needed.`,
            `Der vorgeschlagene Master Gain enthält ${CLIPPING_HEADROOM_DB} dB zusätzlichen Headroom. Spätere Spitzen können höher sein; ein neuer Render pausiert bei Bedarf erneut.`,
          )}</p>
          {pausedClip && gainDb - pausedClip.peakDb - CLIPPING_HEADROOM_DB < -24 && <p className="text-sm text-destructive">{t("The −24 dB gain limit cannot provide the full suggested headroom. Reduce the source level before rendering again.", "Die Gain-Grenze von −24 dB reicht für den vorgeschlagenen Headroom nicht aus. Reduziere den Quellpegel vor dem erneuten Rendern.")}</p>}
          <div className="flex flex-col gap-2">
            <Button disabled={stopping} className="h-auto whitespace-normal py-2" onClick={() => {
              if (!pausedClip) return;
              setGainDb(pausedClip.suggestedGain);
              stopRender();
            }}><Square />{stopping ? t("Stopping…", "Wird gestoppt…") : t(`Stop & set Master Gain to ${pausedClip?.suggestedGain.toFixed(1)} dB`, `Stoppen & Master Gain auf ${pausedClip?.suggestedGain.toFixed(1)} dB setzen`)}</Button>
            <Button variant="outline" disabled={stopping} className="h-auto whitespace-normal py-2" onClick={() => {
              workerRef.current?.postMessage({ type: "continue" });
              setPausedClip(null);
            }}>{t("Continue with hard clipping (no limiter)", "Mit hartem Clipping fortfahren (kein Limiter)")}</Button>
            <Button variant="ghost" disabled={stopping} onClick={stopRender}>{t("Stop without changing gain", "Stoppen ohne Gain-Änderung")}</Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="grid grid-cols-1 items-center gap-5 border-t border-border px-5 py-6 text-[11px] text-muted-foreground xl:grid-cols-[1fr_minmax(0,48rem)_1fr] xl:gap-8">
        <div className="flex shrink-0 items-center justify-center gap-5 xl:justify-start">
          <a href="https://kreativ.institute" target="_blank" rel="noreferrer" aria-label="KreativInstitut.OWL" className="shrink-0">
            <img src={kioLight} alt="KreativInstitut.OWL" className="h-9 w-auto max-w-none shrink-0 dark:hidden" />
            <img src={kioDark} alt="KreativInstitut.OWL" className="hidden h-9 w-auto max-w-none shrink-0 dark:block" />
          </a>
          <div className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide">
            <a href={t("https://kreativ.institute/en/impressum", "https://kreativ.institute/de/impressum")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
              {t("Imprint", "Impressum")} <ArrowUpRight className="size-3" />
            </a>
            <a href={t("https://kreativ.institute/en/datenschutz", "https://kreativ.institute/de/datenschutz")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
              {t("Privacy Policy", "Datenschutz")} <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
        <div className="min-w-0 space-y-2 text-center">
          <p className="mx-auto max-w-2xl text-foreground/80">
            {t("A project by ", "Ein Projekt von ")}
            <a href="https://kreativ.institute/de/ueber-kio/team/sascha-etezazi" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 transition-colors hover:text-foreground">Sascha Armin Etezazi</a>
            {" · KreativInstitut.OWL"}
          </p>
          <p className="mx-auto max-w-2xl text-foreground/80">
            <ShieldCheck className="mr-1.5 inline size-3.5 text-[var(--v2-valid)]" />
            {t(
              "Your audio files never leave your computer. All parsing, spatial math and Ambisonic encoding happen directly on your CPU inside this browser tab. No files are uploaded to any server.",
              "Deine Audiodateien verlassen nie deinen Rechner. Das gesamte Parsing, die Raumberechnung und die Ambisonics-Kodierung laufen direkt auf deiner CPU in diesem Browser-Tab. Es werden keine Dateien auf einen Server hochgeladen.",
            )}
          </p>
          <p className="mx-auto max-w-3xl">
            {t(
              "AURA is an independent tool and is not affiliated with, endorsed by or certified by Dolby Laboratories, Inc. It reads the open Audio Definition Model (ITU-R BS.2076) metadata contained in the files you provide. Dolby, Dolby Atmos and the double-D symbol are trademarks of Dolby Laboratories, Inc.; all trademarks are used for identification purposes only.",
              "AURA ist ein unabhängiges Werkzeug und steht in keiner Verbindung zu Dolby Laboratories, Inc., wird von dort weder unterstützt noch zertifiziert. Es liest die offenen Audio-Definition-Model-Metadaten (ITU-R BS.2076) der von dir bereitgestellten Dateien. Dolby, Dolby Atmos und das Doppel-D-Symbol sind Marken von Dolby Laboratories, Inc.; alle Marken werden ausschließlich zu Identifikationszwecken genannt.",
            )}
          </p>
        </div>
        <div aria-hidden="true" className="hidden xl:block" />
        <p className="font-mono text-[10px] text-muted-foreground/70 xl:col-span-3 xl:text-center">Build {BUILD_TIME}</p>
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
