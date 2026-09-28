/// <reference lib="webworker" />
/**
 * Decodes a window of an already rendered AmbiX file back into planar
 * Float32 channels for the binaural audition. Only the channels the HOAST
 * decoder needs are unpacked (16 for 3rd order, 25 for 4th), so a 36- or
 * 64-channel render stays cheap to audition.
 */

export type DecodeRequest = {
  type: "decode";
  blob: Blob;
  startFrame: number;
  maxFrames: number;
  /** keep at most this many leading ACN channels */
  maxChannels: number;
};

export type DecodeResponse =
  | { type: "progress"; framesDone: number; totalFrames: number }
  | {
      type: "done";
      channels: Float32Array[];
      sampleRate: number;
      frameCount: number;
      startFrame: number;
      totalFrames: number;
      fileChannels: number;
    }
  | { type: "error"; message: string };

const post = (msg: DecodeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

const fourCC = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

async function view(blob: Blob, offset: number, length: number) {
  return new DataView(await blob.slice(offset, offset + length).arrayBuffer());
}

function makeDecoder(bits: number) {
  if (bits === 24)
    return (b: Uint8Array, o: number) =>
      (((b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) << 8) >> 8) / 8388608;
  if (bits === 16)
    return (b: Uint8Array, o: number) => (((b[o]! | (b[o + 1]! << 8)) << 16) >> 16) / 32768;
  if (bits === 32)
    return (b: Uint8Array, o: number) =>
      (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) / 2147483648;
  throw new Error(`Unsupported bit depth: ${bits}`);
}

async function decode(req: DecodeRequest) {
  const { blob } = req;
  const head = await view(blob, 0, 12);
  const riff = fourCC(head, 0);
  if ((riff !== "RIFF" && riff !== "RF64") || fourCC(head, 8) !== "WAVE")
    throw new Error("The rendered file is not a RIFF/RF64 WAVE.");

  let offset = 12;
  let ds64DataSize = -1;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= blob.size) {
    const hdr = await view(blob, offset, 8);
    const id = fourCC(hdr, 0);
    let size = hdr.getUint32(4, true);
    const body = offset + 8;
    if (id === "ds64") {
      const d = await view(blob, body, Math.min(size, 28));
      ds64DataSize = Number(d.getBigUint64(8, true));
    }
    if (id === "fmt ") fmtOffset = body;
    if (id === "data") {
      if (size === 0xffffffff || size === 0) size = ds64DataSize >= 0 ? ds64DataSize : blob.size - body;
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (fmtOffset < 0 || dataOffset < 0) throw new Error("Missing fmt/data chunk.");

  const f = await view(blob, fmtOffset, 24);
  const channels = f.getUint16(2, true);
  const sampleRate = f.getUint32(4, true);
  const bits = f.getUint16(14, true);
  const blockAlign = f.getUint16(12, true) || (channels * bits) / 8;
  const bytes = bits / 8;
  const totalFrames = Math.floor(dataSize / blockAlign);

  const keep = Math.min(channels, req.maxChannels);
  const start = Math.max(0, Math.min(req.startFrame, Math.max(0, totalFrames - 1)));
  const frames = Math.max(0, Math.min(totalFrames - start, req.maxFrames));
  const read = makeDecoder(bits);

  const out: Float32Array[] = [];
  for (let c = 0; c < keep; c++) out.push(new Float32Array(frames));

  const BLOCK = 8192;
  let done = 0;
  let last = 0;
  while (done < frames) {
    const n = Math.min(BLOCK, frames - done);
    const buf = new Uint8Array(
      await blob
        .slice(dataOffset + (start + done) * blockAlign, dataOffset + (start + done + n) * blockAlign)
        .arrayBuffer(),
    );
    for (let i = 0; i < n; i++) {
      const base = i * blockAlign;
      for (let c = 0; c < keep; c++) out[c]![done + i] = read(buf, base + c * bytes);
    }
    done += n;
    const now = performance.now();
    if (now - last > 150 || done >= frames) {
      last = now;
      post({ type: "progress", framesDone: done, totalFrames: frames });
    }
  }

  post(
    {
      type: "done",
      channels: out,
      sampleRate,
      frameCount: frames,
      startFrame: start,
      totalFrames,
      fileChannels: channels,
    },
    out.map((c) => c.buffer),
  );
}

self.onmessage = (ev: MessageEvent<DecodeRequest>) => {
  if (ev.data?.type !== "decode") return;
  decode(ev.data).catch((err: unknown) =>
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }),
  );
};
