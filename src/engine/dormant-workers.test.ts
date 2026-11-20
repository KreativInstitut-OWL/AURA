import { expect, test } from "bun:test";
import type { DecodeResponse } from "./decode.worker";
import type { PreviewResponse } from "./preview-types";

type Scope = { onmessage: (e: MessageEvent) => void; postMessage: (m: unknown) => void };
const scope: Scope = { onmessage: () => {}, postMessage: () => {} };
Object.assign(globalThis, { self: scope });
async function run<T extends { type: string }>(data: unknown): Promise<T[]> {
  const out: T[] = [];
  scope.postMessage = (m) => out.push(m as T);
  scope.onmessage({ data } as MessageEvent);
  for (let n = 0; n < 200 && !out.some((m) => m.type === "done" || m.type === "error"); n++) await new Promise((r) => setTimeout(r, 5));
  return out;
}
function fixture(riff: string, bits: number, tag: number, extensible = false): Blob {
  const ds = riff === "BW64" ? 36 : 0;
  const fmt = extensible ? 40 : 16;
  const header = new Uint8Array(12 + ds + 8 + fmt + 8);
  const v = new DataView(header.buffer);
  const cc = (at: number, text: string) => [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  const data = bits === 64 ? new Float64Array([0.25, -0.5]) : tag === 3 ? new Float32Array([0.25, -0.5]) : new Int32Array([536870912, -1073741824]);
  cc(0, riff); cc(8, "WAVE"); v.setUint32(4, header.length + data.byteLength - 8, true);
  if (ds) { cc(12, "ds64"); v.setUint32(16, 28, true); v.setBigUint64(28, BigInt(data.byteLength), true); }
  const at = 12 + ds;
  cc(at, "fmt "); v.setUint32(at + 4, fmt, true); v.setUint16(at + 8, extensible ? 0xfffe : tag, true);
  v.setUint16(at + 10, 1, true); v.setUint32(at + 12, 48000, true); v.setUint16(at + 20, bits / 8, true); v.setUint16(at + 22, bits, true);
  if (extensible) v.setUint16(at + 32, tag, true);
  cc(at + 8 + fmt, "data"); v.setUint32(at + 12 + fmt, ds ? 0xffffffff : data.byteLength, true);
  return new Blob([header, data.buffer]);
}
test("window decoder preserves IEEE float32/64, extensible float and BW64 samples", async () => {
  await import("./decode.worker");
  for (const [riff, bits, tag, ext] of [["RIFF", 32, 3, false], ["BW64", 64, 3, true], ["BW64", 32, 3, false], ["RIFF", 32, 1, true]] as const) {
    const msgs = await run<DecodeResponse>({ type: "decode", blob: fixture(riff, bits, tag, ext), startFrame: 0, maxFrames: 2, maxChannels: 1 });
    const done = msgs.find((m) => m.type === "done");
    if (done?.type !== "done") throw new Error(JSON.stringify(msgs));
    expect(Array.from(done.channels[0] ?? [])).toEqual([0.25, -0.5]);
    expect(done.sampleRate).toBe(48000);
  }
});
test("dormant preview uses format metadata for float32 and float64", async () => {
  await import("./preview.worker");
  for (const bits of [32, 64]) {
    const data = bits === 32 ? new Float32Array([0.25, -0.5]) : new Float64Array([0.25, -0.5]);
    const msgs = await run<PreviewResponse>({ type: "preview", file: new File([data.buffer], "float.wav"),
      container: { dataOffset: 0, frameCount: 2, channels: 1, sampleRate: 48000, blockAlign: bits / 8, bitsPerSample: bits, isFloat: true },
      sources: [{ channelIndex: 0, kind: "bed", name: "C", uid: "c", isLFE: false, azimuth: 0, elevation: 0, gain: 1, points: [] }],
      order: 3, lfeMode: "exclude", masterGain: 1, startSample: 0, maxFrames: 2,
    });
    const done = msgs.find((m) => m.type === "done");
    if (done?.type !== "done") throw new Error(JSON.stringify(msgs));
    expect(Array.from(done.channels[0] ?? [])).toEqual([0.25, -0.5]);
  }
});