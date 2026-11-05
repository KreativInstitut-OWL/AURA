/// <reference lib="webworker" />
import { positionAt } from "./adm";
import { buildAmbixHeader, packInt24 } from "./ambix";
import { decodeChannel } from "./decode-pcm";
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
  // One decoded buffer per input channel that any source reads.
  const decoded = new Map<number, Float32Array>();
  for (const s of allSources) {
    if (s.channelIndex >= 0 && s.channelIndex < inCh && !decoded.has(s.channelIndex)) {
      decoded.set(s.channelIndex, new Float32Array(FRAME_BLOCK));
    }
  }
  const sig = new Float32Array(FRAME_BLOCK);
  /** Peak per order tier: ACN 0–15 (3OA), 16–35 (adds 5OA), 36–63 (adds 7OA). */
  const groupPeaks = new Float32Array(3);

  while (frame < totalFrames) {
    if (gate.cancelled) return;
    const frames = Math.min(FRAME_BLOCK, totalFrames - frame);
    const byteStart = container.dataOffset + frame * container.blockAlign;
    const byteEnd = byteStart + frames * container.blockAlign;
    const raw = new Uint8Array(await file.slice(byteStart, byteEnd).arrayBuffer());
    if (raw.byteLength < frames * container.blockAlign) break;
    if (gate.cancelled) return;

    // Decode every channel in use exactly once per block.
    for (const [ci, buf] of decoded) {
      decodeChannel(raw, frames, container.blockAlign, ci * bytesPerSample, container.bitsPerSample, container.isFloat, buf);
    }

    // --- Input level metering (drives the spatial viewer) ---
    sourcePeaks.fill(0);
    // Peak scans discard the viewer envelope, so skip that work entirely.
    if (!scan) for (const s of allSources) {
      const ci = s.channelIndex;
      const x = decoded.get(ci);
      if (!x) continue;
      let pk = 0;
      for (let f = 0; f < frames; f++) {
        const v = Math.abs(x[f]!);
        if (v > pk) pk = v;
        const idx = ci * envelopeBins + (((frame + f) / binSamples) | 0);
        if (v > envelope[idx]!) envelope[idx] = v;
      }
      sourcePeaks[ci] = pk;
    }

    planar.fill(0, 0, M * frames);

    // --- Bed: static coefficients, one contiguous pass per ACN channel ---
    for (const b of beds) {
      const C = bedCoeffs.get(b)!;
      const g = b.gain * config.masterGain;
      const x = decoded.get(b.channelIndex)!;
      for (let f = 0; f < frames; f++) sig[f] = x[f]! * g;
      for (let l = 0; l < M; l++) {
        const c = C[l]!;
        if (c === 0) continue;
        const base = l * frames;
        for (let f = 0; f < frames; f++) planar[base + f] = planar[base + f]! + sig[f]! * c;
      }
    }

    // --- LFE: 120 Hz low-pass, placed per the routing setting ---
    for (const l of lfes) {
      const filt = lfeFilters.get(l)!;
      const C = lfeCoeffs.get(l)!;
      const g = (LFE_GAIN_VALUE[config.lfeGain] ?? Math.SQRT1_2) * config.masterGain;
      const x = decoded.get(l.channelIndex)!;
      for (let f = 0; f < frames; f++) sig[f] = filt.process(x[f]!) * g;
      for (let c = 0; c < M; c++) {
        const k = C[c]!;
        if (k === 0) continue;
        const base = c * frames;
        for (let f = 0; f < frames; f++) planar[base + f] = planar[base + f]! + sig[f]! * k;
      }
    }

    // --- Objects: sub-block coefficient ramping ---
    for (const o of objects) {
      const x = decoded.get(o.channelIndex)!;
      let p0 = positionAt(o.points, frame);
      encodeDirection(config.order, p0.azimuth, p0.elevation, cA);
      for (let sub = 0; sub < frames; sub += RAMP) {
        const n = Math.min(RAMP, frames - sub);
        const p1 = positionAt(o.points, frame + sub + n);
        encodeDirection(config.order, p1.azimuth, p1.elevation, cB);
        const g0 = p0.gain * config.masterGain;
        const g1 = p1.gain * config.masterGain;
        let silent = true;
        for (let f = 0; f < n; f++) {
          const v = x[sub + f]! * (g0 + (g1 - g0) * (f / n));
          sig[f] = v;
          if (v !== 0) silent = false;
        }
        if (!silent) for (let l = 0; l < M; l++) {
          const a = cA[l]!;
          const d = cB[l]! - a;
          if (a === 0 && d === 0) continue;
          const base = l * frames + sub;
          for (let f = 0; f < n; f++) planar[base + f] = planar[base + f]! + sig[f]! * (a + d * (f / n));
        }
        // The end of this sub-block is the start of the next one.
        cA.set(cB);
        p0 = p1;
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
      const grp = l < 16 ? 0 : l < 36 ? 1 : 2;
      if (pk > groupPeaks[grp]!) groupPeaks[grp] = pk;
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
      groupPeaks: new Float32Array(groupPeaks),
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
