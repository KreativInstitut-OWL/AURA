/// <reference types="bun" />
/**
 * Regression for the channel-ID file: speech on the LFE track ("Subwoofer")
 * is louder unfiltered than the sub burst that follows, so the estimate used
 * to look at the speech (silenced by the 120 Hz low-pass) and miss the peak.
 */
import { expect, test } from "bun:test";
import { peakWindows } from "./peak-windows";
import { ENVELOPE_BIN_SEC } from "./types";
import type { EnvelopeResponse, WorkerRequest, WorkerResponse } from "./types";

const RATE = 48000;
const SECONDS = 20;
const FRAMES = RATE * SECONDS;

function makeFile(): File {
  // ch0 = Centre bed, ch1 = LFE
  const pcm = new Float32Array(FRAMES * 2);
  for (let i = 0; i < RATE; i++) pcm[(2 * RATE + i) * 2] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / RATE); // "Center"
  for (let i = 0; i < 0.8 * RATE; i++) pcm[(10 * RATE + i) * 2 + 1] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / RATE); // "Subwoofer"
  for (let i = 0; i < 3 * RATE; i++) { // 50 Hz burst: 1 s rise, 1 s hold at 0.5, 1 s fall
    const t = i / RATE;
    const env = t < 1 ? t : t > 2 ? 3 - t : 1;
    pcm[(12 * RATE + i) * 2 + 1] = 0.5 * env * Math.sin(2 * Math.PI * 50 * t);
  }
  return new File([pcm.buffer], "channel_id.wav");
}

type Scope = { onmessage: (e: MessageEvent) => void; postMessage: (m: unknown) => void };
const scope: Scope = { onmessage: () => {}, postMessage: () => {} };
Object.assign(globalThis, { self: scope });

async function runWorker<T extends { type: string }>(handler: (e: MessageEvent) => void, data: unknown): Promise<T[]> {
  const out: T[] = [];
  scope.postMessage = (m) => out.push(m as T);
  handler({ data } as MessageEvent);
  for (let n = 0; n < 2000 && !out.some((m) => m.type === "done" || m.type === "error"); n++) await new Promise((r) => setTimeout(r, 5));
  return out;
}

const container = { dataOffset: 0, frameCount: FRAMES, blockAlign: 8, bitsPerSample: 32, isFloat: true, channels: 2, sampleRate: RATE };
const sources: WorkerRequest["sources"] = [
  { channelIndex: 0, kind: "bed", name: "C", uid: "c", isLFE: false, azimuth: 0, elevation: 0, gain: 1, points: [] },
  { channelIndex: 1, kind: "bed", name: "LFE", uid: "lfe", isLFE: true, azimuth: 0, elevation: -30, gain: 1, points: [] },
];

test("peak estimate at +10 dB LFE (omni) matches the full render", async () => {
  const file = makeFile();
  await import("./envelope.worker");
  const envHandler = scope.onmessage;
  await import("./render.worker");
  const renderHandler = scope.onmessage;

  const binSamples = Math.round(RATE * ENVELOPE_BIN_SEC);
  const bins = Math.ceil(FRAMES / binSamples);
  const envelope = new Float32Array(2 * bins);
  const low = new Float32Array(2 * bins);
  for (const m of await runWorker<EnvelopeResponse>(envHandler, { type: "scan", file, container, binSamples })) {
    if (m.type !== "bins") continue;
    for (let b = 0; b < m.count; b++) for (let c = 0; c < 2; c++) {
      envelope[c * bins + m.startBin + b] = m.data[b * 2 + c]!;
      low[c * bins + m.startBin + b] = m.low[b * 2 + c]!;
    }
  }

  const config = { order: 7, lfeRouting: "omni", lfeGain: "plus10", masterGain: 1 } as WorkerRequest["config"];
  const peakOf = async (windows?: [number, number][]) => {
    const msgs = await runWorker<WorkerResponse>(renderHandler, { type: "render", file, sources, container, config, scanOnly: true, windows });
    const done = msgs.find((m) => m.type === "done");
    if (done?.type !== "done") throw new Error("scan did not finish");
    return 20 * Math.log10(done.maxPeak);
  };

  const full = await peakOf([[0, FRAMES]]);
  const fixed = await peakOf(peakWindows(envelope, bins, binSamples, [0, 1], RATE / 4, FRAMES, { envelope: low, channels: new Set([1]) }));
  const old = await peakOf(peakWindows(envelope, bins, binSamples, [0, 1], RATE / 4, FRAMES));
  console.log({ full: full.toFixed(2), fixed: fixed.toFixed(2), old: old.toFixed(2) });

  expect(full).toBeGreaterThan(3.5); // 0.5 × +10 dB ≈ +3.9 dBFS
  expect(Math.abs(fixed - full)).toBeLessThan(0.1);
  expect(old).toBeLessThan(0); // the old lookup missed the sub burst entirely
});
