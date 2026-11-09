import { useLang } from "@/lib/i18n";
import { useEffect, useRef, useState, type RefObject } from "react";

import { positionAt } from "@/engine/adm";
import type { LevelState, LfeRouting, RenderSource } from "@/engine/types";

interface Props {
  sources: RenderSource[];
  frameCount: number;
  sampleRate: number;
  playheadSample: number;
  spinning?: boolean;
  /** live / scanned input levels; dots scale with the signal when present */
  levelsRef?: RefObject<LevelState>;
  /** how the LFE channel is encoded — drives the LFE marker */
  lfeRouting?: LfeRouting;
  /** follow playheadSample (during a render); otherwise the viewer animates its own idle playhead */
  followPlayhead?: boolean;
  /** receives the currently drawn playhead sample each frame (no re-render) */
  playheadOutRef?: RefObject<number>;
}

/** Objects often arrive as "Stem - Role"; only the role part is worth drawing. */
function shortLabel(name: string): string {
  const parts = name.split(/\s+[-–/]\s+/);
  const tail = parts[parts.length - 1]?.trim();
  return tail && tail.length > 0 ? tail : name;
}

/** Isometric 3D dome view of bed anchors and animated object trajectories. */
export function SpatialViewer({
  sources,
  frameCount,
  sampleRate,
  playheadSample,
  spinning = true,
  levelsRef,
  lfeRouting = "omni",
  followPlayhead = false,
  playheadOutRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yawRef = useRef(0.6);
  const dragRef = useRef<{ x: number; yaw: number } | null>(null);
  const stateRef = useRef({ sources, frameCount, sampleRate, playheadSample, spinning, lfeRouting, followPlayhead });
  stateRef.current = { sources, frameCount, sampleRate, playheadSample, spinning, lfeRouting, followPlayhead };
  const [showLevels, setShowLevels] = useState(true);
  const showLevelsRef = useRef(true);
  showLevelsRef.current = showLevels;
  const levels = levelsRef;
  const [autoRotate, setAutoRotate] = useState(true);
  const autoRef = useRef(true);
  autoRef.current = autoRotate;
  const { t, lang } = useLang();
  const langRef = useRef(lang);
  langRef.current = lang;



  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const t0 = performance.now();

    // Plain hex per theme: UI tokens are oklch greys in dark mode and render grey on canvas.
    const PALETTE = {
      light: { bed: "#0284c7", obj: "#f59e0b", wire: "#94a3b8", label: "#64748b" },
      dark: { bed: "#38bdf8", obj: "#fbbf24", wire: "#64748b", label: "#94a3b8" },
    };

    const draw = () => {
      const {
        sources: srcs,
        frameCount: total,
        playheadSample: headProp,
        sampleRate: rate,
        followPlayhead: follow,
        spinning: spin,
        lfeRouting: lfeMode,
      } = stateRef.current;
      // Idle playhead runs here at 4x realtime so the page never re-renders per frame.
      const head = follow
        ? headProp
        : total > 0
          ? (((performance.now() - t0) / 1000) * rate * 4) % total
          : 0;
      if (playheadOutRef) (playheadOutRef as { current: number }).current = head;
      const pal = document.documentElement.classList.contains("dark") ? PALETTE.dark : PALETTE.light;
      const cPrimary = pal.bed;
      const cAccent = pal.obj;
      const cBorder = pal.wire;
      const cMuted = pal.label;
      const lower = srcs.some(
        (x) =>
          (x.kind === "bed" && !x.isLFE && x.elevation < -1e-3) ||
          (x.isLFE && lfeMode === "position" && x.elevation < -1e-3) ||
          (x.kind === "object" && x.points.some((pt) => pt.elevation < -1e-3)),
      );

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (spin && autoRef.current && !dragRef.current) yawRef.current += 0.0025;
      const yaw = yawRef.current;
      const pitch = 0.5;
      const cx = w / 2;
      const cy = h / 2 + h * 0.08;
      const R = Math.min(w, h) * 0.36;

      /**
       * Normalised 0..1 loudness of an input channel at the current playhead.
       * Live render peaks win over the scanned envelope; -60 dBFS maps to 0.
       */
      const levelOf = (channelIndex: number): number => {
        const st = levels?.current;
        if (!st || !showLevelsRef.current) return -1;
        let v = -1;
        if (st.live && channelIndex < st.live.length) v = st.live[channelIndex]!;
        else if (st.envelope && st.bins > 0) {
          const bin = Math.min(st.bins - 1, Math.max(0, Math.floor(head / st.binSamples)));
          const idx = channelIndex * st.bins + bin;
          if (idx < st.envelope.length) v = st.envelope[idx]!;
        }
        if (v < 0) return -1;
        if (v <= 0) return 0;
        const db = 20 * Math.log10(v);
        return Math.min(1, Math.max(0, (db + 60) / 60));
      };


      const project = (az: number, el: number, r: number) => {
        // world: x right, y front, z up — positive azimuth is to the listener's left
        const x = r * Math.cos(el) * Math.sin(az);

        const y = r * Math.cos(el) * Math.cos(az);
        const z = r * Math.sin(el);
        const xr = x * Math.cos(yaw) - y * Math.sin(yaw);
        const yr = x * Math.sin(yaw) + y * Math.cos(yaw);
        return {
          sx: cx + xr * R,
          sy: cy - z * R * Math.cos(pitch) + yr * R * Math.sin(pitch),
          depth: yr,
        };
      };

      // Dome wireframe
      ctx.lineWidth = 1;
      ctx.strokeStyle = cBorder;
      const rings = lower
        ? [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]
        : [0, Math.PI / 6, Math.PI / 3];
      for (const el of rings) {
        ctx.lineWidth = el === 0 ? 1.5 : 1;
        ctx.globalAlpha = el === 0 ? 1 : el < 0 ? 0.55 : 0.75;
        ctx.beginPath();
        for (let a = 0; a <= 360; a += 4) {
          const p = project((a * Math.PI) / 180, el, 1);
          if (a === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      const eStart = lower ? -90 : -20;
      for (let a = 0; a < 360; a += 45) {
        ctx.beginPath();
        for (let e = eStart; e <= 90; e += 5) {
          const p = project((a * Math.PI) / 180, (e * Math.PI) / 180, 1);
          if (e === eStart) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Front marker
      // Placed outside the dome and below ear level so it never meets the C label.
      const front = project(0, -0.12, 1.3);
      ctx.fillStyle = cMuted;
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("FRONT", front.sx, front.sy + 14);

      // Bed anchors (directional speakers only) — size follows the channel level
      for (const s of srcs.filter((x) => x.kind === "bed" && !x.isLFE)) {
        const p = project(s.azimuth, s.elevation, 1);
        const lv = levelOf(s.channelIndex);
        const half = lv < 0 ? 5 : 5 + lv * 4;
        ctx.fillStyle = cPrimary;
        ctx.globalAlpha = (p.depth > 0 ? 1 : 0.5) * (lv < 0 ? 1 : 0.6 + lv * 0.4);
        ctx.beginPath();
        ctx.rect(p.sx - half, p.sy - half, half * 2, half * 2);
        ctx.fill();
        ctx.globalAlpha = p.depth > 0 ? 1 : 0.5;
        ctx.fillStyle = cMuted;
        ctx.fillText(shortLabel(s.name), p.sx, p.sy - half - 5);
        ctx.globalAlpha = 1;
      }


      // LFE marker — placement and caption follow the chosen routing
      const lfeSources = srcs.filter((x) => x.isLFE);
      if (lfeSources.length && lfeMode !== "off") {
        const positional = lfeMode === "position";
        for (const l of lfeSources) {
          const o = positional ? project(l.azimuth, l.elevation, 1) : project(0, 0, 0);
          const lv = levelOf(l.channelIndex);
          const radius = (lv < 0 ? 9 : 7 + lv * 5) * (positional ? 0.8 : 1);
          ctx.strokeStyle = cMuted;
          ctx.globalAlpha = 0.75;
          ctx.setLineDash(lfeMode === "position" ? [] : [3, 3]);
          ctx.beginPath();
          ctx.arc(o.sx, o.sy, radius, 0, Math.PI * 2);
          ctx.stroke();
          if (lfeMode === "down") {
            // short downward tail: energy is steered toward the floor
            ctx.beginPath();
            ctx.moveTo(o.sx, o.sy + radius);
            ctx.lineTo(o.sx, o.sy + radius + 10);
            ctx.moveTo(o.sx - 4, o.sy + radius + 5);
            ctx.lineTo(o.sx, o.sy + radius + 10);
            ctx.lineTo(o.sx + 4, o.sy + radius + 5);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.fillStyle = cMuted;
          const caption =
            lfeMode === "omni"
              ? `${l.name} · omni → W`
              : lfeMode === "down"
                ? `${l.name} · ${langRef.current === "de" ? "untere Hemisphäre" : "lower hemisphere"} (W − Z)`
                : lfeMode === "position"
                  ? `${l.name} · ${((l.azimuth * 180) / Math.PI).toFixed(0)}° / ${((l.elevation * 180) / Math.PI).toFixed(0)}°`
                  : `${l.name}`;
          ctx.fillText(
            caption,
            o.sx,
            o.sy + radius + (lfeMode === "down" ? 26 : 16),
          );
          ctx.globalAlpha = 1;
        }
      }


      // Object trajectories
      const objects = srcs.filter((x) => x.kind === "object");
      objects.forEach((s, i) => {
        ctx.strokeStyle = cAccent;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const steps = 160;
        for (let k = 0; k <= steps; k++) {
          const t = (k / steps) * Math.max(total, 1);
          const pos = positionAt(s.points, t);
          const p = project(pos.azimuth, pos.elevation, Math.min(pos.distance || 1, 1.2));
          if (k === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();

        const now = positionAt(s.points, head);
        const p = project(now.azimuth, now.elevation, Math.min(now.distance || 1, 1.2));
        const lv = levelOf(s.channelIndex);
        const core = lv < 0 ? 6 : 6 + lv * 5;
        ctx.globalAlpha = lv < 0 ? 1 : 0.6 + lv * 0.4;
        ctx.fillStyle = cAccent;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, core, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = lv < 0 ? 0.2 : 0.1 + lv * 0.25;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, core * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (i < 14) {
          ctx.fillStyle = cMuted;
          ctx.fillText(shortLabel(s.name), p.sx, p.sy - core - 7);
        }


      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative">
    <canvas
      ref={canvasRef}
      className="h-[380px] w-full cursor-grab touch-none rounded-lg bg-background/40 active:cursor-grabbing"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, yaw: yawRef.current };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        yawRef.current = dragRef.current.yaw - (e.clientX - dragRef.current.x) * 0.008;
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    />
      <button
        type="button"
        onClick={() => setShowLevels((v) => !v)}
        aria-label={showLevels ? t("Hide level display", "Pegelanzeige ausblenden") : t("Show level display", "Pegelanzeige einblenden")}
        title={showLevels ? t("Hide level display", "Pegelanzeige ausblenden") : t("Show level display", "Pegelanzeige einblenden")}
        aria-pressed={showLevels}
        className="absolute bottom-2 right-11 inline-flex size-7 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0" />
          {!showLevels && <path d="M3 3l18 18" />}
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setAutoRotate((v) => !v)}
        aria-label={autoRotate ? t("Stop auto-rotation", "Auto-Drehung anhalten") : t("Start auto-rotation", "Auto-Drehung starten")}
        title={autoRotate ? t("Stop auto-rotation", "Auto-Drehung anhalten") : t("Start auto-rotation", "Auto-Drehung starten")}
        aria-pressed={autoRotate}
        className="absolute bottom-2 right-2 inline-flex size-7 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2" />
          <path d="m15.194 13.707 3.814 1.86-1.86 3.814" />
          <path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4" />
          {!autoRotate && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}
