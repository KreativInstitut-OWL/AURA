import { describe, expect, it } from "vitest";
import { activeAt } from "./adm";

describe("audioObject time window", () => {
  const sr = 48000;
  const obj = { activeStart: 3 * sr, activeEnd: 6 * sr }; // start 3 s, duration 3 s

  it("is silent before its start", () => expect(activeAt(obj, 3 * sr - 1)).toBe(0));
  it("is audible from its start", () => expect(activeAt(obj, 3 * sr)).toBe(1));
  it("is silent from start + duration on", () => expect(activeAt(obj, 6 * sr)).toBe(0));
  it("objects without a window are always audible", () => expect(activeAt({}, 10 * sr)).toBe(1));
});
