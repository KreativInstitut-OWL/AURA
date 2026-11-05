import { expect, test } from "bun:test";
import { peakWindows } from "./peak-windows";

test("one 500 ms window per channel peak, overlaps merged, silent channels skipped", () => {
  const bins = 100, binSamples = 2400, half = 12000; // 48 kHz, ±250 ms
  const env = new Float32Array(3 * bins);
  env[0 * bins + 10] = 0.9; // ch0 peak at bin 10
  env[1 * bins + 12] = 0.8; // ch1 peak at bin 12 -> overlaps ch0
  // ch2 silent
  const w = peakWindows(env, bins, binSamples, [0, 1, 2], half, bins * binSamples);
  expect(w).toEqual([[10 * 2400 + 1200 - half, 12 * 2400 + 1200 + half]]);
});

test("windows are clamped to the file", () => {
  const env = new Float32Array(10);
  env[0] = 1;
  expect(peakWindows(env, 10, 2400, [0], 12000, 24000)).toEqual([[0, 13200]]);
});
