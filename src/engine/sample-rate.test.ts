import { expect, test } from "bun:test";
import { peakWindows } from "./peak-windows";
import { admTimeToSamples } from "./adm";
import { buildAmbixHeader } from "./ambix";
import { ENVELOPE_BIN_SEC } from "./types";

for (const rate of [48000, 96000]) {
  test(`${rate / 1000} kHz: 500 ms peak window spans exactly 0.5 s of samples`, () => {
    const binSamples = Math.round(rate * ENVELOPE_BIN_SEC);
    const bins = 200;
    const env = new Float32Array(bins);
    env[100] = 1;
    const half = Math.round(rate * 0.25);
    const [[s, e]] = peakWindows(env, bins, binSamples, [0], half, bins * binSamples) as [[number, number]];
    expect(e - s).toBe(rate / 2);
  });

  test(`${rate / 1000} kHz: ADM time 00:00:01.5 lands on 1.5 s`, () => {
    expect(admTimeToSamples("00:00:01.50000", rate)).toBe(rate * 1.5);
  });

  test(`${rate / 1000} kHz: exported header keeps the input sample rate`, () => {
    const h = buildAmbixHeader({ channels: 16, sampleRate: rate, frameCount: 10 });
    expect(new DataView(h.buffer).getUint32(24, true)).toBe(rate);
  });
}
