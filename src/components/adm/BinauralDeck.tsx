import { Headphones, Loader2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { renderBinauralStereo, resampleLinear, type BinauralStereo } from "@/lib/hoast";

export interface PreviewAudio {
  channels: Float32Array[];
  sampleRate: number;
  /** frames held in memory (the audition window) */
  frameCount: number;
  /** ambisonic order actually decoded to headphones (3 or 4) */
  order: 3 | 4;
  /** order of the file that will be exported */
  renderOrder: number;
  /** true when the window is shorter than the whole programme */
  truncated: boolean;
  /** window start in seconds, relative to the file */
  startSec: number;
  /** whole-file duration in seconds */
  fullDurationSec: number;
  /** where the audio came from */
  source: "preview" | "render";
}

interface Props {
  preview: PreviewAudio | null;
  generating: boolean;
  progress: number;
  canGenerate: boolean;
  onGenerate: () => void;
  /** ask the host to decode another window of the rendered file */
  onSeekWindow?: ((sec: number) => void) | undefined;
  windowLoading?: boolean | undefined;
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "00:00.000";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

export function BinauralDeck({
  preview,
  generating,
  progress,
  canGenerate,
  onGenerate,
  onSeekWindow,
  windowLoading = false,
}: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const { t } = useLang();
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stereoRef = useRef<BinauralStereo | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [trimDb, setTrimDb] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // window-relative seconds
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const windowStart = preview?.startSec ?? 0;
  const windowDur = preview ? preview.frameCount / preview.sampleRate : 0;
  const fullDur = preview ? preview.fullDurationSec || windowDur : 0;

  const trimLin = stereoRef.current && stereoRef.current.peak > 0
    ? Math.min(1, 0.5 / stereoRef.current.peak)
    : 1;

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setPlaying(false);
  }, []);

  // Pre-compute the binaural mix whenever a new audition window arrives.
  useEffect(() => {
    stop();
    setReady(false);
    setPosition(0);
    offsetRef.current = 0;
    stereoRef.current = null;
    bufferRef.current = null;
    if (!preview) return;

    let cancelled = false;
    setErr(null);
    setDecoding(true);

    (async () => {
      try {
        const stereo = await renderBinauralStereo(
          preview.channels,
          preview.frameCount,
          preview.sampleRate,
          preview.order,
        );
        if (cancelled) return;
        stereoRef.current = stereo;
        setTrimDb(stereo.peak > 0.5 ? 20 * Math.log10(0.5 / stereo.peak) : 0);
        setReady(true);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = (muted ? 0 : volume) * trimLin;
  }, [volume, muted, trimLin]);

  // Playhead ticker
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx) {
        const p = offsetRef.current + (ctx.currentTime - startedAtRef.current);
        setPosition(Math.min(p, windowDur));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, windowDur]);

  /** The context is created inside the click handler: both Chrome and Safari
   *  only unlock audio when it is opened in the same gesture. */
  const ensureContext = useCallback(() => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gainRef.current = gain;
      ctxRef.current = ctx;
      bufferRef.current = null;
    }
    return ctx;
  }, []);

  const ensureBuffer = useCallback((ctx: AudioContext) => {
    if (bufferRef.current) return bufferRef.current;
    const stereo = stereoRef.current;
    if (!stereo) return null;
    const rate = ctx.sampleRate;
    const l = rate === stereo.sampleRate ? stereo.left : resampleLinear(stereo.left, stereo.sampleRate, rate);
    const r = rate === stereo.sampleRate ? stereo.right : resampleLinear(stereo.right, stereo.sampleRate, rate);
    const buf = ctx.createBuffer(2, l.length, rate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    bufferRef.current = buf;
    return buf;
  }, []);

  const playFrom = useCallback(
    async (offset: number) => {
      const ctx = ensureContext();
      const gain = gainRef.current;
      const buf = ensureBuffer(ctx);
      if (!gain || !buf) return;
      gain.gain.value = (muted ? 0 : volume) * trimLin;
      await ctx.resume().catch(() => undefined);
      stop();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.onended = () => setPlaying(false);
      offsetRef.current = offset;
      startedAtRef.current = ctx.currentTime;
      src.start(0, offset);
      sourceRef.current = src;
      setPlaying(true);
    },
    [ensureBuffer, ensureContext, muted, stop, trimLin, volume],
  );

  const toggle = () => {
    if (playing) {
      const ctx = ctxRef.current;
      if (ctx) offsetRef.current += ctx.currentTime - startedAtRef.current;
      stop();
    } else {
      void playFrom(position >= windowDur ? 0 : position);
    }
  };

  /** slider works in absolute file seconds */
  const seekAbsolute = (abs: number) => {
    const rel = abs - windowStart;
    if (rel < 0 || rel > windowDur) {
      if (onSeekWindow) {
        stop();
        onSeekWindow(abs);
      }
      return;
    }
    setPosition(rel);
    offsetRef.current = rel;
    if (playing) void playFrom(rel);
  };

  const badge =
    preview === null
      ? null
      : preview.renderOrder <= 3
        ? t(`${preview.order}rd-order binaural · ${preview.channels.length} ch`, `Binaural ${preview.order}. Ordnung · ${preview.channels.length} Kan.`)
        : t(`${preview.order}th-order binaural · ${preview.channels.length} of ${(preview.renderOrder + 1) ** 2} ch`, `Binaural ${preview.order}. Ordnung · ${preview.channels.length} von ${(preview.renderOrder + 1) ** 2} Kan.`);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Headphones className="size-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("Binaural audition", "Binaurales Vorhören")}
        </h3>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        {t(
          "Headphone monitoring decodes through the IEM Graz HOAST spherical-harmonic HRIR set (Neumann KU100) into a fixed stereo mix, then plays that back. Those filters go up to 4th order, so 5th and 7th order renders are auditioned at 4th order. The exported file always carries every channel.",
          "Das Kopfhörer-Monitoring dekodiert über den HOAST-HRIR-Satz der IEM Graz (Neumann KU100) in einen festen Stereomix und spielt diesen ab. Die Filter reichen bis zur 4. Ordnung, daher werden Renderings in 5. und 7. Ordnung in 4. Ordnung vorgehört. Die exportierte Datei enthält immer alle Kanäle.",
        )}
      </p>

      {trimDb < -0.1 && (
        <p className="mb-3 font-mono text-[11px] text-[var(--v2-valid)]">
          {t(`Monitor trim ${trimDb.toFixed(1)} dB — listening only, the export is untouched.`, `Abhörpegel ${trimDb.toFixed(1)} dB — nur zum Hören, der Export bleibt unverändert.`)}
        </p>
      )}

      <button
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {generating ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {t("Preparing preview…", "Vorschau wird erstellt…")} {progress.toFixed(0)}%
          </span>
        ) : preview?.source === "preview" ? (
          t("Re-render quick preview", "Schnellvorschau neu erstellen")
        ) : (
          t("Quick preview (first minute)", "Schnellvorschau (erste Minute)")
        )}
      </button>

      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[10px] text-primary">
              {badge}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${
                preview.source === "render"
                  ? "border-[var(--v2-valid)]/40 bg-[var(--v2-valid)]/10 text-[var(--v2-valid)]"
                  : "border-accent/40 bg-accent/10 text-accent"
              }`}
            >
              {preview.source === "render" ? t("rendered file", "gerenderte Datei") : t("quick preview", "Schnellvorschau")}
            </span>
            {preview.truncated && (
              <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                {t("window", "Fenster")} {fmt(windowStart)} – {fmt(windowStart + windowDur)}
              </span>
            )}
            {(decoding || windowLoading) && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {windowLoading ? t("loading window…", "Fenster wird geladen…") : t("decoding binaural mix…", "Binauralmix wird dekodiert…")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              disabled={!ready || windowLoading}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              onClick={() => seekAbsolute(windowStart)}
              disabled={!ready || windowLoading}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={fullDur || 1}
                step={0.01}
                value={windowStart + position}
                disabled={!ready || windowLoading}
                onChange={(e) => seekAbsolute(Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
              />
              <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                <span>{fmt(windowStart + position)}</span>
                <span>{fmt(fullDur)}</span>
              </div>
            </div>
          </div>

          {preview.source === "render" && preview.truncated && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "The rendered file is auditioned in memory-sized windows — drag the timeline anywhere and the next window loads from that point.",
                "Die gerenderte Datei wird in speichergerechten Fenstern vorgehört — zieh die Zeitleiste an eine beliebige Stelle, dann wird ab dort das nächste Fenster geladen.",
              )}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMuted((m) => !m)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
            />
            <span className="w-10 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {Math.round((muted ? 0 : volume) * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
