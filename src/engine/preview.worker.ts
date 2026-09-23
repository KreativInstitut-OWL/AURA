/// <reference lib="webworker" />
import { positionAt } from "./adm";
import { channelCount, encodeDirection } from "./sh";
import type { PreviewRequest, PreviewResponse } from "./preview-types";
import { LFE_MODE_GAIN, type RenderSource } from "./types";

const FRAME_BLOCK = 4096;
const RAMP = 64;

/** 4th-order Butterworth low-pass (two cascaded biquads), direct form I. */
class Butterworth4 {
  private s: {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  }[] = [];
  constructor(fc: number, fs: number) {
    for (const q of [0.541196, 1.306563]) {
      const w = (2 * Math.PI * fc) / fs;
      const cw = Math.cos(w);
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      this.s.push({
        b0: (1 - cw) / 2 / a0,
        b1: (1 - cw) / a0,
        b2: (1 - cw) / 2 / a0,
        a1: (-2 * cw) / a0,
        a2: (1 - alpha) / a0,
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 0,
      });
    }
  }
  process(x: number): number {
    let v = x;
    for (const s of this.s) {
      const y = s.b0 * v + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
      s.x2 = s.x1;
      s.x1 = v;
      s.y2 = s.y1;
      s.y1 = y;
      v = y;
    }
    return v;
  }
}

function makeDecoder(bits: number) {
  if (bits === 24)
    return (b: Uint8Array, o: number) =>
      (((b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) << 8) >> 8) / 8388608;
  if (bits === 16) return (b: Uint8Array, o: number) => (((b[o]! | (b[o + 1]! << 8)) << 16) >> 16) / 32768;
  if (bits === 32)
    return (b: Uint8Array, o: number) =>
      (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) / 2147483648;
  throw new Error(`Unsupported bit depth: ${bits}`);
}

const post = (msg: PreviewResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function renderPreview(req: PreviewRequest) {
  const { file, container } = req;
  const M = channelCount(req.order);
  const start = Math.max(0, Math.min(req.startSample, container.frameCount));
  const available = container.frameCount - start;
  const totalFrames = Math.max(0, Math.min(available, req.maxFrames));
  const truncated = available > totalFrames;
  const decode = makeDecoder(container.bitsPerSample);

  const sources = req.sources.filter((s) => !(s.isLFE && req.lfeMode === "exclude"));
  const beds = sources.filter((s) => s.kind === "bed" && !s.isLFE);
  const lfes = sources.filter((s) => s.isLFE);
  const objects = sources.filter((s) => s.kind === "object");

  const bedCoeffs = new Map<RenderSource, Float32Array>();
  for (const b of beds) {
    bedCoeffs.set(b, encodeDirection(req.order, b.azimuth, b.elevation, new Float32Array(M)));
  }
  const lfeFilters = new Map<RenderSource, Butterworth4>();
  for (const l of lfes) lfeFilters.set(l, new Butterworth4(120, container.sampleRate));

  // One contiguous Float32Array per ambisonic channel -> straight into an AudioBuffer.
  const out: Float32Array[] = Array.from({ length: M }, () => new Float32Array(totalFrames));
  const cA = new Float32Array(M);
  const cB = new Float32Array(M);
  const bytesPerSample = container.bitsPerSample / 8;

  let frame = 0;
  let lastPost = 0;
  while (frame < totalFrames) {
    const frames = Math.min(FRAME_BLOCK, totalFrames - frame);
    const byteStart = container.dataOffset + (start + frame) * container.blockAlign;
    const raw = new Uint8Array(
      await file.slice(byteStart, byteStart + frames * container.blockAlign).arrayBuffer(),
    );
    if (raw.byteLength < frames * container.blockAlign) break;

    for (const b of beds) {
      const C = bedCoeffs.get(b)!;
      const g = b.gain * req.masterGain;
      const chOff = b.channelIndex * bytesPerSample;
      for (let f = 0; f < frames; f++) {
        const s = decode(raw, f * container.blockAlign + chOff) * g;
        if (s === 0) continue;
        const idx = frame + f;
        for (let l = 0; l < M; l++) out[l]![idx] = out[l]![idx]! + s * C[l]!;
      }
    }

    for (const l of lfes) {
      const filt = lfeFilters.get(l)!;
      const g = (LFE_MODE_GAIN[req.lfeMode] ?? Math.SQRT1_2) * req.masterGain;
      const chOff = l.channelIndex * bytesPerSample;
      const w = out[0]!;
      for (let f = 0; f < frames; f++) {
        w[frame + f] = w[frame + f]! + filt.process(decode(raw, f * container.blockAlign + chOff)) * g;
      }
    }

    for (const o of objects) {
      const chOff = o.channelIndex * bytesPerSample;
      for (let sub = 0; sub < frames; sub += RAMP) {
        const n = Math.min(RAMP, frames - sub);
        const t0 = start + frame + sub;
        const p0 = positionAt(o.points, t0);
        const p1 = positionAt(o.points, t0 + n);
        encodeDirection(req.order, p0.azimuth, p0.elevation, cA);
        encodeDirection(req.order, p1.azimuth, p1.elevation, cB);
        const g0 = p0.gain * req.masterGain;
        const g1 = p1.gain * req.masterGain;
        for (let f = 0; f < n; f++) {
          const t = f / n;
          const s = decode(raw, (sub + f) * container.blockAlign + chOff) * (g0 + (g1 - g0) * t);
          if (s === 0) continue;
          const idx = frame + sub + f;
          for (let l = 0; l < M; l++) {
            out[l]![idx] = out[l]![idx]! + s * (cA[l]! + (cB[l]! - cA[l]!) * t);
          }
        }
      }
    }

    frame += frames;
    const now = performance.now();
    if (now - lastPost > 150 || frame >= totalFrames) {
      lastPost = now;
      post({ type: "progress", framesDone: frame, totalFrames });
    }
  }

  post(
    {
      type: "done",
      channels: out,
      sampleRate: container.sampleRate,
      frameCount: totalFrames,
      order: req.order,
      truncated,
    },
    out.map((c) => c.buffer as ArrayBuffer),
  );
}

self.onmessage = (ev: MessageEvent<PreviewRequest>) => {
  if (ev.data?.type !== "preview") return;
  renderPreview(ev.data).catch((err: unknown) => {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
};
