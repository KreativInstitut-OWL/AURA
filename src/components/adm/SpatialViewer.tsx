import { useEffect, useRef } from "react";

import { positionAt } from "@/engine/adm";
import type { RenderSource } from "@/engine/types";

interface Props {
  sources: RenderSource[];
  frameCount: number;
  sampleRate: number;
  playheadSample: number;
  spinning?: boolean;
}

/** Isometric 3D dome view of bed anchors and animated object trajectories. */
export function SpatialViewer({
  sources,
  frameCount,
  sampleRate,
  playheadSample,
  spinning = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yawRef = useRef(0.6);
  const dragRef = useRef<{ x: number; yaw: number } | null>(null);
  const stateRef = useRef({ sources, frameCount, sampleRate, playheadSample, spinning });
  stateRef.current = { sources, frameCount, sampleRate, playheadSample, spinning };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const cPrimary = color("--primary", "#5ad");
    const cAccent = color("--accent", "#fb0");
    const cBorder = color("--border", "#444");
    const cMuted = color("--muted-foreground", "#888");

    const draw = () => {
      const { sources: srcs, frameCount: total, playheadSample: head, spinning: spin } =
        stateRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (spin && !dragRef.current) yawRef.current += 0.0025;
      const yaw = yawRef.current;
      const pitch = 0.5;
      const cx = w / 2;
      const cy = h / 2 + h * 0.08;
      const R = Math.min(w, h) * 0.36;

      const project = (az: number, el: number, r: number) => {
        // world: x right, y front, z up
        const x = r * Math.cos(el) * Math.sin(-az);
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
      for (const el of [0, Math.PI / 6, Math.PI / 3]) {
        ctx.strokeStyle = el === 0 ? cBorder : cBorder;
        ctx.globalAlpha = el === 0 ? 0.9 : 0.4;
        ctx.beginPath();
        for (let a = 0; a <= 360; a += 4) {
          const p = project((a * Math.PI) / 180, el, 1);
          if (a === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      for (let a = 0; a < 360; a += 45) {
        ctx.beginPath();
        for (let e = -20; e <= 90; e += 5) {
          const p = project((a * Math.PI) / 180, (e * Math.PI) / 180, 1);
          if (e === -20) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Front marker
      const front = project(0, 0, 1.12);
      ctx.fillStyle = cMuted;
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("FRONT", front.sx, front.sy);

      // Bed anchors
      for (const s of srcs.filter((x) => x.kind === "bed")) {
        const p = project(s.azimuth, s.isLFE ? -0.35 : s.elevation, s.isLFE ? 0.45 : 1);
        ctx.fillStyle = s.isLFE ? cMuted : cPrimary;
        ctx.globalAlpha = p.depth > 0 ? 1 : 0.5;
        ctx.beginPath();
        ctx.rect(p.sx - 4, p.sy - 4, 8, 8);
        ctx.fill();
        ctx.fillStyle = cMuted;
        ctx.fillText(s.name, p.sx, p.sy - 9);
        ctx.globalAlpha = 1;
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
        ctx.globalAlpha = 1;
        ctx.fillStyle = cAccent;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (i < 14) {
          ctx.fillStyle = cMuted;
          ctx.fillText(s.name.slice(0, 14), p.sx, p.sy - 12);
        }
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-[380px] w-full cursor-grab touch-none rounded-lg bg-background/40 active:cursor-grabbing"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, yaw: yawRef.current };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        yawRef.current = dragRef.current.yaw + (e.clientX - dragRef.current.x) * 0.008;
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    />
  );
}
