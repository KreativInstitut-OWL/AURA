/**
 * Sample decoders for the supported WAV payloads:
 * 16 / 24 / 32-bit signed integer PCM and 32 / 64-bit IEEE float.
 * Shared by the render worker and the background level-envelope scanner.
 */
export function makeDecoder(bits: number, isFloat: boolean) {
  if (isFloat) {
    if (bits === 32) {
      return (bytes: Uint8Array, byteOffset: number) =>
        new DataView(bytes.buffer, bytes.byteOffset + byteOffset, 4).getFloat32(0, true);
    }
    if (bits === 64) {
      return (bytes: Uint8Array, byteOffset: number) =>
        new DataView(bytes.buffer, bytes.byteOffset + byteOffset, 8).getFloat64(0, true);
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
