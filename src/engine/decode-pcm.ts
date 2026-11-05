/**
 * Sample decoders for the supported WAV payloads:
 * 16 / 24 / 32-bit signed integer PCM and 32 / 64-bit IEEE float.
 * Shared by the render worker and the background level-envelope scanner.
 */
// Shared scratch avoids allocating a DataView per sample (little-endian hosts).
const scratch = new Uint8Array(8);
const f32 = new Float32Array(scratch.buffer, 0, 1);
const f64 = new Float64Array(scratch.buffer);

/**
 * Decode one interleaved channel of a block into `out` in a single tight loop.
 * Same values as makeDecoder, but without a function call per sample.
 */
export function decodeChannel(
  bytes: Uint8Array, frames: number, blockAlign: number, chOff: number,
  bits: number, isFloat: boolean, out: Float32Array,
): void {
  let o = chOff;
  if (isFloat) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bits === 32) for (let f = 0; f < frames; f++, o += blockAlign) out[f] = dv.getFloat32(o, true);
    else if (bits === 64) for (let f = 0; f < frames; f++, o += blockAlign) out[f] = dv.getFloat64(o, true);
    else throw new Error(`Unsupported float bit depth: ${bits}`);
    return;
  }
  if (bits === 24) {
    for (let f = 0; f < frames; f++, o += blockAlign) {
      const u = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
      out[f] = ((u << 8) >> 8) / 8388608;
    }
  } else if (bits === 16) {
    for (let f = 0; f < frames; f++, o += blockAlign) {
      const u = bytes[o]! | (bytes[o + 1]! << 8);
      out[f] = ((u << 16) >> 16) / 32768;
    }
  } else if (bits === 32) {
    for (let f = 0; f < frames; f++, o += blockAlign) {
      out[f] = (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) / 2147483648;
    }
  } else throw new Error(`Unsupported bit depth: ${bits}`);
}

export function makeDecoder(bits: number, isFloat: boolean) {
  if (isFloat) {
    if (bits === 32) {
      return (bytes: Uint8Array, byteOffset: number) => {
        const b = byteOffset;
        scratch[0] = bytes[b]!; scratch[1] = bytes[b + 1]!; scratch[2] = bytes[b + 2]!; scratch[3] = bytes[b + 3]!;
        return f32[0]!;
      };
    }
    if (bits === 64) {
      return (bytes: Uint8Array, byteOffset: number) => {
        for (let i = 0; i < 8; i++) scratch[i] = bytes[byteOffset + i]!;
        return f64[0]!;
      };
    }
    throw new Error(`Unsupported float bit depth: ${bits}`);
  }
  if (bits === 24) {
    return (bytes: Uint8Array, byteOffset: number) => {
      const u = bytes[byteOffset]! | (bytes[byteOffset + 1]! << 8) | (bytes[byteOffset + 2]! << 16);
      return ((u << 8) >> 8) / 8388608;
    };
  }
  if (bits === 16) {
    return (bytes: Uint8Array, byteOffset: number) => {
      const u = bytes[byteOffset]! | (bytes[byteOffset + 1]! << 8);
      return ((u << 16) >> 16) / 32768;
    };
  }
  if (bits === 32) {
    return (bytes: Uint8Array, byteOffset: number) => {
      const u =
        bytes[byteOffset]! |
        (bytes[byteOffset + 1]! << 8) |
        (bytes[byteOffset + 2]! << 16) |
        (bytes[byteOffset + 3]! << 24);
      return u / 2147483648;
    };
  }
  throw new Error(`Unsupported bit depth: ${bits}`);
}
