/// <reference lib="webworker" />
/**
 * Background peak-envelope scanner.
 *
 * Reads the source file in small slices (never more than a few MB at a time)
 * and reduces it to one absolute peak value per input channel per time bin.
 * The bin grid is derived from the sample clock, so it is frame-accurate with
 * the ADM keyframe timeline used by the spatial viewer.
 */
import { makeDecoder } from "./decode-pcm";
import type { EnvelopeRequest, EnvelopeResponse } from "./types";

const SLICE_BYTES = 2 * 1024 * 1024; // keep peak memory tiny

const post = (msg: EnvelopeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function scan(req: EnvelopeRequest) {
  const { file, container, binSamples } = req;
  const { channels, blockAlign, bitsPerSample, isFloat, dataOffset, frameCount } = container;
  const decode = makeDecoder(bitsPerSample, isFloat);
  const bytesPerSample = bitsPerSample / 8;
  const totalBins = Math.max(1, Math.ceil(frameCount / binSamples));
  const framesPerSlice = Math.max(binSamples, Math.floor(SLICE_BYTES / blockAlign));

  let frame = 0;
  // Flush a batch of finished bins whenever it grows past this many bins.
  const FLUSH_BINS = 256;
  let batch: number[] = [];
  let batchStart = 0;

  const flush = () => {
    if (batch.length === 0) return;
    const data = new Float32Array(batch);
    post({ type: "bins", startBin: batchStart, count: data.length / channels, channels, data }, [
      data.buffer,
    ]);
    batch = [];
  };

  while (frame < frameCount) {
    const frames = Math.min(framesPerSlice, frameCount - frame);
    const byteStart = dataOffset + frame * blockAlign;
    const raw = new Uint8Array(
      await file.slice(byteStart, byteStart + frames * blockAlign).arrayBuffer(),
    );
    const available = Math.floor(raw.byteLength / blockAlign);
    if (available <= 0) break;

    let f = 0;
    while (f < available) {
      const absFrame = frame + f;
      const bin = Math.floor(absFrame / binSamples);
      const binEnd = Math.min(available, (bin + 1) * binSamples - frame);
      const peaks = new Float32Array(channels);
      for (let i = f; i < binEnd; i++) {
        const base = i * blockAlign;
        for (let c = 0; c < channels; c++) {
          const v = Math.abs(decode(raw, base + c * bytesPerSample));
          if (v > peaks[c]!) peaks[c] = v;
        }
      }
      if (batch.length === 0) batchStart = bin;
      for (let c = 0; c < channels; c++) batch.push(peaks[c]!);
      f = binEnd;
      if (batch.length / channels >= FLUSH_BINS) flush();
    }

    frame += available;
    // Yield to the event loop so a cancel message can land between slices.
    await new Promise((r) => setTimeout(r, 0));
  }

  flush();
  post({ type: "done", totalBins });
}

self.onmessage = (ev: MessageEvent<EnvelopeRequest>) => {
  if (ev.data?.type !== "scan") return;
  scan(ev.data).catch((err: unknown) => {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
};
