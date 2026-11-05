/// <reference lib="webworker" />
import { positionAt } from "./adm";
import { buildAmbixHeader, packInt24 } from "./ambix";
import { makeDecoder } from "./decode-pcm";
import { channelCount, encodeDirection } from "./sh";
import { ClippingGate } from "./clipping";
import type { RenderSource, RenderWorkerMessage, WorkerRequest, WorkerResponse } from "./types";

const FRAME_BLOCK = 32768; // frames per pass — large blocks keep browser file reads few (each slice is a slow async call)
const RAMP = 64; // sub-block coefficient ramp interval
import { ENVELOPE_BIN_SEC, LFE_GAIN_VALUE } from "./types";

/** 4th-order Butterworth low-pass (two cascaded biquads), direct form I. */
class Butterworth4 {
  private s: { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }[] = [];
  constructor(fc: number, fs: number) {
    const qs = [0.541196, 1.306563]; // Butterworth 4th-order section Qs
    for (const q of qs) {
      const w = (2 * Math.PI * fc) / fs;
      const cw = Math.cos(w);
      const alpha = Math.sin(w) / (2 * q);
      const b0 = (1 - cw) / 2;
      const b1 = 1 - cw;
      const b2 = (1 - cw) / 2;
      const a0 = 1 + alpha;
      this.s.push({
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
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



const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function render(req: WorkerRequest, gate: ClippingGate) {
  const { file, config, container } = req;
  const M = channelCount(config.order);
  const totalFrames = container.frameCount;
  const decode = makeDecoder(container.bitsPerSample, container.isFloat);
  const started = performance.now();

  const sources = req.sources.filter((s) => !(s.isLFE && config.lfeRouting === "off"));
  const beds = sources.filter((s) => s.kind === "bed" && !s.isLFE);
  const lfes = sources.filter((s) => s.isLFE);
  const objects = sources.filter((s) => s.kind === "object");

  // Static coefficient vectors for the bed (evaluated once).
  const bedCoeffs = new Map<RenderSource, Float32Array>();
  for (const b of beds) {
    bedCoeffs.set(b, encodeDirection(config.order, b.azimuth, b.elevation, new Float32Array(M)));
  }
  const lfeFilters = new Map<RenderSource, Butterworth4>();
  // Spatial placement of the low-passed LFE, chosen by the routing setting.
  const lfeCoeffs = new Map<RenderSource, Float32Array>();
  for (const l of lfes) {
    lfeFilters.set(l, new Butterworth4(120, container.sampleRate));
    const C = new Float32Array(M);
    if (config.lfeRouting === "position") {
      encodeDirection(config.order, l.azimuth, l.elevation, C);
    } else {
      C[0] = 1; // W
      // Downward first-order cardioid: W + Z with Z pointing at the floor.
      if (config.lfeRouting === "down" && M > 2) C[2] = -1;
    }
    lfeCoeffs.set(l, C);
  }


  // Output sink
  let writable: FileSystemWritableFileStream | null = null;
  const blobParts: BlobPart[] = [];
  let closed = false;
  try {
  const scan = req.scanOnly === true;
  if (req.handle && !scan) writable = await req.handle.createWritable();
  const header = buildAmbixHeader({
    channels: M,
    sampleRate: container.sampleRate,
    frameCount: totalFrames,
  });
  let bytesWritten = 0;
  // When a file handle is available the data streams straight to disk and is
  // never buffered, which keeps memory flat for multi-gigabyte renders.
  const write = async (chunk: Uint8Array<ArrayBuffer>) => {
    // Peak scans measure only; nothing is written or buffered.
    if (scan) return;
    if (writable) await writable.write(chunk);
    else blobParts.push(new Uint8Array(chunk).buffer);
    bytesWritten += chunk.byteLength;
  };
  await write(header);

  const planar = new Float32Array(M * FRAME_BLOCK);
  const outBytes = new Uint8Array(M * FRAME_BLOCK * 3);
  const cA = new Float32Array(M);
  const cB = new Float32Array(M);
  const peaks = new Float32Array(M);
  const bytesPerSample = container.bitsPerSample / 8;

  let frame = 0;
  let lastPost = 0;
  let maxPeak = 0;
  let maxPeakChannel = 0;
  let pausedMs = 0;

  // Level envelope of the *input* channels, measured on the same sample grid
  // the spatial viewer uses, so the animation stays frame-accurate.
  const binSamples = Math.max(1, Math.round(container.sampleRate * ENVELOPE_BIN_SEC));
  const envelopeBins = Math.max(1, Math.ceil(totalFrames / binSamples));
  const inCh = container.channels;
  const envelope = new Float32Array(inCh * envelopeBins);
  const sourcePeaks = new Float32Array(inCh);
  const allSources = req.sources;

  while (frame < totalFrames) {
    if (gate.cancelled) return;
    const frames = Math.min(FRAME_BLOCK, totalFrames - frame);
    const byteStart = container.dataOffset + frame * container.blockAlign;
    const byteEnd = byteStart + frames * container.blockAlign;
    const raw = new Uint8Array(await file.slice(byteStart, byteEnd).arrayBuffer());
    if (raw.byteLength < frames * container.blockAlign) break;
    if (gate.cancelled) return;

    // --- Input level metering (drives the spatial viewer) ---
    sourcePeaks.fill(0);
    // Peak scans discard the viewer envelope, so skip that work entirely.
    if (!scan) for (const s of allSources) {
      const ci = s.channelIndex;
      if (ci < 0 || ci >= inCh) continue;
      const chOff = ci * bytesPerSample;
      let pk = 0;
      for (let f = 0; f < frames; f++) {
        const v = Math.abs(decode(raw, f * container.blockAlign + chOff));
        if (v > pk) pk = v;
        const bin = ((frame + f) / binSamples) | 0;
        const idx = ci * envelopeBins + bin;
        if (v > envelope[idx]!) envelope[idx] = v;
      }
      sourcePeaks[ci] = pk;
    }

    planar.fill(0, 0, M * frames);


    // --- Bed: static coefficients ---
    for (const b of beds) {
      const C = bedCoeffs.get(b)!;
      const g = b.gain * config.masterGain;
      const chOff = b.channelIndex * bytesPerSample;
      for (let f = 0; f < frames; f++) {
        const s = decode(raw, f * container.blockAlign + chOff) * g;
        if (s === 0) continue;
        for (let l = 0; l < M; l++) planar[l * frames + f] = planar[l * frames + f]! + s * C[l]!;
      }
    }

    // --- LFE: 120 Hz low-pass, placed per the routing setting ---
    for (const l of lfes) {
      const filt = lfeFilters.get(l)!;
      const C = lfeCoeffs.get(l)!;
      const g = (LFE_GAIN_VALUE[config.lfeGain] ?? Math.SQRT1_2) * config.masterGain;
      const chOff = l.channelIndex * bytesPerSample;
      for (let f = 0; f < frames; f++) {
        const s = filt.process(decode(raw, f * container.blockAlign + chOff)) * g;
        if (s === 0) continue;
        for (let c = 0; c < M; c++) {
          if (C[c] === 0) continue;
          planar[c * frames + f] = planar[c * frames + f]! + s * C[c]!;
        }
      }
    }


    // --- Objects: sub-block coefficient ramping ---
    for (const o of objects) {
      const chOff = o.channelIndex * bytesPerSample;
      for (let sub = 0; sub < frames; sub += RAMP) {
        const n = Math.min(RAMP, frames - sub);
        const t0 = frame + sub;
        const p0 = positionAt(o.points, t0);
        const p1 = positionAt(o.points, t0 + n);
        encodeDirection(config.order, p0.azimuth, p0.elevation, cA);
        encodeDirection(config.order, p1.azimuth, p1.elevation, cB);
        const g0 = p0.gain * config.masterGain;
        const g1 = p1.gain * config.masterGain;
        for (let f = 0; f < n; f++) {
          const t = f / n;
          const s = decode(raw, (sub + f) * container.blockAlign + chOff) * (g0 + (g1 - g0) * t);
          if (s === 0) continue;
          const idx = sub + f;
          for (let l = 0; l < M; l++) {
            const c = cA[l]! + (cB[l]! - cA[l]!) * t;
            planar[l * frames + idx] = planar[l * frames + idx]! + s * c;
          }
        }
      }
    }

    // Meters — also track the global maximum before 24-bit quantisation clamps it.
    for (let l = 0; l < M; l++) {
      let pk = 0;
      const base = l * frames;
      for (let f = 0; f < frames; f++) {
        const a = Math.abs(planar[base + f]!);
        if (a > pk) pk = a;
      }
      peaks[l] = pk;
      if (pk > maxPeak) {
        maxPeak = pk;
        maxPeakChannel = l;
      }
    }

    // Hold the current float block before quantisation or writing any clipped audio.
    if (!scan && gate.shouldPause(maxPeak)) {
      const pausedAt = performance.now();
      const waiting = gate.wait();
      post({
        type: "clipping", framesDone: frame, totalFrames, bytesWritten,
        elapsedMs: pausedAt - started - pausedMs, maxPeak, maxPeakChannel,
      });
      await waiting;
      pausedMs += performance.now() - pausedAt;
      if (gate.cancelled) return;
    }

    if (!scan) packInt24(planar, M, frames, outBytes);
    if (!scan) await write(outBytes.subarray(0, M * frames * 3));

    frame += frames;
    const now = performance.now();
    if (now - lastPost > 120 || frame >= totalFrames) {
      lastPost = now;
      post({
        type: "progress",
        framesDone: frame,
        totalFrames,
        peaks: new Float32Array(peaks),
        bytesWritten,
        elapsedMs: now - started - pausedMs,
        maxPeak,
        maxPeakChannel,
        sourcePeaks: new Float32Array(sourcePeaks),
      });
    }
  }

  if (gate.cancelled) return;
  if (writable) await writable.close();
  closed = true;
  const envCopy = new Float32Array(envelope);
  post(
    {
      type: "done",
      blob: writable || scan ? null : new Blob(blobParts, { type: "audio/wav" }),
      bytesWritten,
      elapsedMs: performance.now() - started - pausedMs,
      maxPeak,
      maxPeakChannel,
      // The render already read every sample, so the viewer gets the full
      // envelope for free — no second pass over the file is needed.
      envelope: envCopy,
      envelopeBins,
      binSamples,
    },
    [envCopy.buffer],
  );

  } finally {
    // Discard the unfinished direct-to-disk transaction rather than leave a partial WAV.
    if (writable && !closed) await writable.abort();
  }
}

let activeGate: ClippingGate | null = null;
self.onmessage = (ev: MessageEvent<RenderWorkerMessage>) => {
  if (ev.data?.type === "continue") { activeGate?.continue(); return; }
  if (ev.data?.type === "cancel") { activeGate?.cancel(); return; }
  if (ev.data?.type !== "render" || activeGate) return;
  const gate = new ClippingGate();
  activeGate = gate;
  render(ev.data, gate).then(() => {
    if (gate.cancelled) post({ type: "cancelled" });
  }).catch((err: unknown) => {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }).finally(() => {
    activeGate = null;
  });
};
