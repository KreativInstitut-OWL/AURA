import { describe, expect, test } from "bun:test";
import { CLIPPING_HEADROOM_DB, ClippingGate, suggestedMasterGain } from "./clipping";

describe("clipping handling", () => {
  test("+1.5 dB at unity suggests -2.5 dB with 1 dB safety margin", () => {
    expect(CLIPPING_HEADROOM_DB).toBe(1);
    expect(suggestedMasterGain(0, 1.5)).toBe(-2.5);
  });
  test("gain reduction is relative to current gain and rounds down", () => {
    expect(suggestedMasterGain(-3, 1.53)).toBe(-5.6);
  });
  test("recommendations respect the existing -24 dB gain floor", () => {
    expect(suggestedMasterGain(-23, 3)).toBe(-24);
  });
  test("clean samples do not pause or change gain", () => {
    expect(new ClippingGate().shouldPause(1)).toBe(false);
    expect(suggestedMasterGain(0, -2)).toBe(0);
  });
  test("clipping waits for explicit continuation and acknowledges later clipping", async () => {
    const gate = new ClippingGate();
    expect(gate.shouldPause(1.1)).toBe(true);
    let resumed = false;
    const waiting = gate.wait().then(() => { resumed = true; });
    await Promise.resolve();
    expect(resumed).toBe(false);
    gate.continue();
    await waiting;
    expect(resumed).toBe(true);
    expect(gate.shouldPause(2)).toBe(false);
    expect(new ClippingGate().shouldPause(2)).toBe(true);
  });
  test("cancel releases a paused render without acknowledging clipping", async () => {
    const gate = new ClippingGate();
    const waiting = gate.wait();
    gate.cancel();
    await waiting;
    expect(gate.cancelled).toBe(true);
  });
});