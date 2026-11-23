import { expect, test } from "bun:test";
import { DEFAULT_LFE_GAIN, LFE_GAIN_VALUE } from "./types";
import { Butterworth4 } from "./butterworth";
import type { LfeGain, RenderWorkerMessage, WorkerRequest, WorkerResponse } from "./types";

test("LFE defaults to exactly 0 dB unity", () => {
  expect(DEFAULT_LFE_GAIN).toBe("unity");
  expect(LFE_GAIN_VALUE[DEFAULT_LFE_GAIN]).toBe(1);
});

test("LFE exposes only 0 dB and +10 dB", () => {
  expect(Object.keys(LFE_GAIN_VALUE).sort()).toEqual(["plus10", "unity"]);
  expect(20 * Math.log10(LFE_GAIN_VALUE.plus10)).toBeCloseTo(10, 12);
});

test("50 Hz Omni render uses unity, preserves +10 dB, and falls back to unity for an obsolete gain", async () => {
  const messages: WorkerResponse[] = [];
  const scope = {
    onmessage: (_event: MessageEvent<RenderWorkerMessage>) => {},
    postMessage: (message: WorkerResponse) => messages.push(message),
  };
  Object.assign(globalThis, { self: scope });
  await import("./render.worker");
  const rate = 48000;
  const samples = Float32Array.from({ length: rate }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 50 * i / rate));
  const filter = new Butterworth4(120, rate);
  let filteredPeak = 0;
  for (const sample of samples) filteredPeak = Math.max(filteredPeak, Math.abs(filter.process(sample)));
  const base: WorkerRequest = {
    type: "render", file: new File([samples.buffer], "50Hz.wav"), handle: null, scanOnly: true,
    sources: [{ channelIndex: 0, kind: "bed", name: "LFE", uid: "lfe", isLFE: true, azimuth: 0, elevation: 0, gain: 1, points: [] }],
    container: { dataOffset: 0, frameCount: rate, blockAlign: 4, bitsPerSample: 32, isFloat: true, channels: 1, sampleRate: rate },
    config: { order: 3, lfeRouting: "omni", lfeGain: DEFAULT_LFE_GAIN, masterGain: 1 },
  };
  for (const gain of ["unity", "plus10", "minus3"]) {
    messages.length = 0;
    // Simulate an old runtime request as well as the two current typed values.
    const request = { ...base, config: { ...base.config, lfeGain: gain as LfeGain } };
    scope.onmessage({ data: request } as MessageEvent<RenderWorkerMessage>);
    for (let n = 0; n < 200 && !messages.some((m) => m.type === "done" || m.type === "error"); n++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const done = messages.find((m) => m.type === "done");
    if (done?.type !== "done") throw new Error(`LFE render failed for ${gain}`);
    const expectedGain = gain === "plus10" ? Math.pow(10, 10 / 20) : 1;
    expect(done.maxPeak).toBeCloseTo(filteredPeak * expectedGain, 6);
    expect(done.maxPeakChannel).toBe(0);
    // Allow the worker's completion cleanup to release its request gate.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});