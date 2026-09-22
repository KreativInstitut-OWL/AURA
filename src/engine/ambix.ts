/** AmbiX (ACN / SN3D) WAV / RF64 header writer + 24-bit PCM packing. */

const KSDATAFORMAT_SUBTYPE_PCM = [
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];

const RF64_THRESHOLD = 0xfffffff0;

function writeFourCC(view: DataView, offset: number, id: string) {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, id.charCodeAt(i));
}

export interface AmbixHeaderOptions {
  channels: number;
  sampleRate: number;
  frameCount: number;
  bitsPerSample?: number;
}

/**
 * Builds a complete WAVE_FORMAT_EXTENSIBLE header. RF64 + ds64 is emitted
 * automatically once the payload crosses the 4 GB RIFF limit.
 */
export function buildAmbixHeader(opts: AmbixHeaderOptions): Uint8Array<ArrayBuffer> {
  const bits = opts.bitsPerSample ?? 24;
  const bytesPerSample = bits / 8;
  const blockAlign = opts.channels * bytesPerSample;
  const dataSize = opts.frameCount * blockAlign;
  const fmtSize = 40;
  const useRF64 = dataSize + 100 > RF64_THRESHOLD;

  const ds64Size = useRF64 ? 8 + 28 : 0;
  const headerSize = 12 + ds64Size + 8 + fmtSize + 8;
  const riffSize = headerSize - 8 + dataSize;

  const buf = new ArrayBuffer(headerSize);
  const v = new DataView(buf);
  let o = 0;

  writeFourCC(v, 0, useRF64 ? "RF64" : "RIFF");
  v.setUint32(4, useRF64 ? 0xffffffff : riffSize >>> 0, true);
  writeFourCC(v, 8, "WAVE");
  o = 12;

  if (useRF64) {
    writeFourCC(v, o, "ds64");
    v.setUint32(o + 4, 28, true);
    v.setBigUint64(o + 8, BigInt(riffSize), true);
    v.setBigUint64(o + 16, BigInt(dataSize), true);
    v.setBigUint64(o + 24, BigInt(opts.frameCount), true);
    v.setUint32(o + 32, 0, true); // table length
    o += 36;
  }

  writeFourCC(v, o, "fmt ");
  v.setUint32(o + 4, fmtSize, true);
  v.setUint16(o + 8, 0xfffe, true); // WAVE_FORMAT_EXTENSIBLE
  v.setUint16(o + 10, opts.channels, true);
  v.setUint32(o + 12, opts.sampleRate, true);
  v.setUint32(o + 16, opts.sampleRate * blockAlign, true);
  v.setUint16(o + 20, blockAlign, true);
  v.setUint16(o + 22, bits, true);
  v.setUint16(o + 24, 22, true); // cbSize
  v.setUint16(o + 26, bits, true); // wValidBitsPerSample
  v.setUint32(o + 28, 0, true); // dwChannelMask = 0 (no speaker remapping)
  for (let i = 0; i < 16; i++) v.setUint8(o + 32 + i, KSDATAFORMAT_SUBTYPE_PCM[i]!);
  o += 8 + fmtSize;

  writeFourCC(v, o, "data");
  v.setUint32(o + 4, useRF64 ? 0xffffffff : dataSize >>> 0, true);

  return new Uint8Array(buf);
}

/** Planar float buffers -> interleaved little-endian 24-bit PCM. */
export function packInt24(
  planar: Float32Array,
  channels: number,
  frames: number,
  out: Uint8Array,
): void {
  let p = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      let s = planar[c * frames + f]!;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      const q = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607)));
      const u = q < 0 ? q + 0x1000000 : q;
      out[p++] = u & 0xff;
      out[p++] = (u >> 8) & 0xff;
      out[p++] = (u >> 16) & 0xff;
    }
  }
}
