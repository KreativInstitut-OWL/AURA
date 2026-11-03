/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { RenderWorkerMessage, WorkerRequest, WorkerResponse } from "./types";

test("direct-to-disk clipping holds the block; cancel aborts, continue closes without duplicate writes", async () => {
  const messages: WorkerResponse[] = [];
  const scope = { onmessage: (_event: MessageEvent<RenderWorkerMessage>) => {}, postMessage: (m: WorkerResponse) => messages.push(m) };
  Object.assign(globalThis, { self: scope });
  await import("./render.worker");
  const until = async (predicate: () => boolean) => {
    for (let n = 0; n < 200 && !predicate(); n++) await new Promise((r) => setTimeout(r, 5));
    expect(predicate()).toBe(true);
  };
  const send = (data: RenderWorkerMessage) => scope.onmessage({ data } as MessageEvent<RenderWorkerMessage>);
  const samples = new Float32Array(4096).fill(1.2);
  const writes: Uint8Array[] = [];
  let aborted = 0;
  let closed = 0;
  const handle = { createWritable: async () => ({
    write: async (data: Uint8Array) => { writes.push(new Uint8Array(data)); },
    close: async () => { closed++; }, abort: async () => { aborted++; },
  }) } as unknown as FileSystemFileHandle;
  const req: WorkerRequest = {
    type: "render", file: new File([samples.buffer], "test.wav"), handle,
    sources: [{ channelIndex: 0, kind: "bed", name: "C", uid: "test", isLFE: false, azimuth: 0, elevation: 0, gain: 1, points: [] }],
    container: { dataOffset: 0, frameCount: 4096, blockAlign: 4, bitsPerSample: 32, isFloat: true, channels: 1, sampleRate: 48000 },
    config: { order: 3, lfeRouting: "off", lfeGain: "unity", masterGain: 1 },
  };
  send(req);
  await until(() => messages.some((m) => m.type === "clipping"));
  expect(writes.length).toBe(1); // Header only: no clipped audio committed.
  const pause = messages.find((m) => m.type === "clipping");
  if (pause?.type !== "clipping") throw new Error("Missing clipping notification");
  expect(pause.framesDone).toBe(0);
  expect(pause.maxPeak).toBeCloseTo(1.2, 5);
  expect(pause.maxPeakChannel).toBe(0);
  send({ type: "cancel" });
  await until(() => messages.some((m) => m.type === "cancelled"));
  expect(aborted).toBe(1);
  expect(closed).toBe(0);
  expect(messages.some((m) => m.type === "done")).toBe(false);
  await new Promise((r) => setTimeout(r, 10));
  messages.length = 0;
  writes.length = 0;
  send(req);
  await until(() => messages.some((m) => m.type === "clipping"));
  send({ type: "continue" });
  await until(() => messages.some((m) => m.type === "done"));
  expect(messages.filter((m) => m.type === "clipping").length).toBe(1);
  expect(writes.length).toBe(3); // One header, exactly two audio blocks.
  const header = writes[0];
  if (!header) throw new Error("Missing WAV header");
  expect(writes.reduce((sum, b) => sum + b.length, 0)).toBe(header.length + 4096 * 16 * 3);
  expect(closed).toBe(1);
  expect(aborted).toBe(1);
});