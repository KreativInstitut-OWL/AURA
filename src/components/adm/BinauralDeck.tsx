import { Headphones, Loader2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { HoastBinauralDecoder, loadHoastFilters } from "@/lib/hoast";

export interface PreviewAudio {
  channels: Float32Array[];
  sampleRate: number;
  frameCount: number;
  /** ambisonic order actually decoded to headphones (3 or 4) */
  order: 3 | 4;
  /** order of the file that will be exported */
  renderOrder: number;
  truncated: boolean;
  startSec: number;
}

interface Props {
  preview: PreviewAudio | null;
  generating: boolean;
  progress: number;
  canGenerate: boolean;
  onGenerate: () => void;
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "00:00.000";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

export function BinauralDeck({ preview, generating, progress, canGenerate, onGenerate }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const decoderRef = useRef<HoastBinauralDecoder | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [trimDb, setTrimDb] = useState(0);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const duration = preview ? preview.frameCount / preview.sampleRate : 0;

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

  // Build the audio graph whenever a new preview render arrives.
  useEffect(() => {
    stop();
    setReady(false);
    setPosition(0);
    offsetRef.current = 0;
    if (!preview) return;

    let cancelled = false;
    setErr(null);
    setLoadingFilters(true);

    (async () => {
      try {
        // Run the context at the render's own rate where the browser allows
        // it, so nothing in the monitor path is resampled.
        let ctx = ctxRef.current;
        if (ctx && ctx.sampleRate !== preview.sampleRate) {
          decoderRef.current?.disconnect();
          decoderRef.current = null;
          void ctx.close();
          ctx = null;
        }
        if (!ctx) {
          try {
            ctx = new AudioContext({ sampleRate: preview.sampleRate });
          } catch {
            ctx = new AudioContext();
          }
        }
        ctxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

        const buf = ctx.createBuffer(
          preview.channels.length,
          preview.frameCount,
          ctx.sampleRate,
        );
        let peak = 0;
        for (let i = 0; i < preview.channels.length; i++) {
          const ch = preview.channels[i]!;
          for (let n = 0; n < ch.length; n++) {
            const v = Math.abs(ch[n]!);
            if (v > peak) peak = v;
          }
          buf.getChannelData(i).set(ch);
        }
        bufferRef.current = buf;

        // Binaural decoding of a dense HOA scene adds roughly 4 dB over the
        // ambisonic peak, so trim the monitor path to stay clear of clipping.
        const trimLin = peak > 0 ? Math.min(1, 0.5 / peak) : 1;
        setTrimDb(trimLin < 1 ? 20 * Math.log10(trimLin) : 0);

        decoderRef.current?.disconnect();
        const decoder = new HoastBinauralDecoder(ctx, preview.order);
        const trim = ctx.createGain();
        trim.gain.value = trimLin;
        const gain = ctx.createGain();
        gain.gain.value = muted ? 0 : volume;
        decoder.output.connect(trim);
        trim.connect(gain);
        gain.connect(ctx.destination);
        decoderRef.current = decoder;
        gainRef.current = gain;

        const filters = await loadHoastFilters(ctx, preview.order);
        if (cancelled) return;
        decoder.setFilters(filters);
        setReady(true);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  useEffect(() => () => {
    stop();
    decoderRef.current?.disconnect();
    void ctxRef.current?.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : volume;
  }, [volume, muted]);

  // Playhead ticker
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx) {
        const p = offsetRef.current + (ctx.currentTime - startedAtRef.current);
        setPosition(Math.min(p, duration));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const playFrom = useCallback(
    async (offset: number) => {
      const ctx = ctxRef.current;
      const decoder = decoderRef.current;
      const buf = bufferRef.current;
      if (!ctx || !decoder || !buf) return;
      await ctx.resume();
      stop();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.channelCountMode = "explicit";
      src.channelCount = buf.numberOfChannels;
      src.connect(decoder.input);
      src.onended = () => setPlaying(false);
      offsetRef.current = offset;
      startedAtRef.current = ctx.currentTime;
      src.start(0, offset);
      sourceRef.current = src;
      setPlaying(true);
    },
    [stop],
  );

  const toggle = () => {
    if (playing) {
      const ctx = ctxRef.current;
      if (ctx) offsetRef.current += ctx.currentTime - startedAtRef.current;
      stop();
    } else {
      void playFrom(position >= duration ? 0 : position);
    }
  };

  const seek = (value: number) => {
    setPosition(value);
    offsetRef.current = value;
    if (playing) void playFrom(value);
  };

  const badge =
    preview === null
      ? null
      : preview.renderOrder <= 3
        ? `Full ${preview.order}rd-order binaural · ${preview.channels.length} ch`
        : `${preview.order}th-order binaural preview · ${preview.channels.length} of ${(preview.renderOrder + 1) ** 2} ch`;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Headphones className="size-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Binaural audition
        </h3>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Headphone monitoring decodes through the IEM Graz HOAST spherical-harmonic HRIR set
        (Neumann KU100). Those filters go up to 4th order, so 5th and 7th order renders are
        auditioned at 4th order. The exported file always carries every channel.
      </p>

      {trimDb < -0.1 && (
        <p className="mb-3 font-mono text-[11px] text-[var(--v2-valid)]">
          Monitor trim {trimDb.toFixed(1)} dB — listening only, the export is untouched.
        </p>
      )}

      <button
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {generating ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Preparing preview… {progress.toFixed(0)}%
          </span>
        ) : preview ? (
          "Re-render preview"
        ) : (
          "Prepare binaural preview"
        )}
      </button>

      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[10px] text-primary">
              {badge}
            </span>
            {preview.truncated && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[10px] text-accent">
                first {Math.round(duration)} s only
              </span>
            )}
            {loadingFilters && (
              <span className="font-mono text-[10px] text-muted-foreground">loading HRIRs…</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              disabled={!ready}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              onClick={() => seek(0)}
              disabled={!ready}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.01}
                value={position}
                disabled={!ready}
                onChange={(e) => seek(Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
              />
              <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                <span>{fmt(position + preview.startSec)}</span>
                <span>{fmt(duration + preview.startSec)}</span>
              </div>
            </div>
          </div>

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
