import type { ChnaEntry, ChunkRef, ContainerInfo, WavFormat } from "./types";

const dec = new TextDecoder("utf-8");
const ascii = new TextDecoder("ascii");

async function readSlice(file: File, offset: number, length: number): Promise<DataView> {
  const buf = await file.slice(offset, offset + length).arrayBuffer();
  return new DataView(buf);
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Walks the chunk table of a RIFF or RF64 (BWF) file without loading bodies.
 * Handles ds64 for multi-gigabyte Atmos masters.
 */
export async function parseContainer(file: File): Promise<ContainerInfo> {
  const head = await readSlice(file, 0, 12);
  const riffId = fourCC(head, 0);
  const form = fourCC(head, 8);
  // BW64 (ITU-R BS.2088) is structurally identical to RF64: same ds64 table,
  // same 64-bit sizes — only the leading FourCC differs.
  if ((riffId !== "RIFF" && riffId !== "RF64" && riffId !== "BW64") || form !== "WAVE") {
    throw new Error("Not a RIFF/RF64/BW64 WAVE file (found '" + riffId + "'/'" + form + "').");
  }
  const isRF64 = riffId === "RF64" || riffId === "BW64";


  const chunks: ChunkRef[] = [];
  let ds64DataSize = -1;
  let ds64SampleCount = -1;
  let offset = 12;
  const fileSize = file.size;

  while (offset + 8 <= fileSize) {
    const hdr = await readSlice(file, offset, 8);
    const id = fourCC(hdr, 0);
    let size = hdr.getUint32(4, true);
    const body = offset + 8;

    if (id === "ds64") {
      const d = await readSlice(file, body, Math.min(size, 28));
      ds64DataSize = Number(d.getBigUint64(8, true));
      ds64SampleCount = Number(d.getBigUint64(16, true));
    }
    if (id === "data" && isRF64 && size === 0xffffffff) {
      if (ds64DataSize < 0) throw new Error("RF64 file is missing its ds64 chunk.");
      size = ds64DataSize;
    }
    chunks.push({ id, offset: body, size });
    offset = body + size + (size % 2);
    if (size === 0xffffffff) break; // unknown length, cannot continue safely
  }

  const find = (id: string) => chunks.find((c) => c.id === id);
  const fmtRef = find("fmt ");
  const dataRef = find("data");
  if (!fmtRef || !dataRef) throw new Error("Missing 'fmt ' or 'data' chunk.");

  const f = await readSlice(file, fmtRef.offset, Math.min(fmtRef.size, 40));
  let formatTag = f.getUint16(0, true);
  const format: WavFormat = {
    formatTag,
    channels: f.getUint16(2, true),
    sampleRate: f.getUint32(4, true),
    blockAlign: f.getUint16(12, true),
    bitsPerSample: f.getUint16(14, true),
  };
  if (formatTag === 0xfffe && fmtRef.size >= 40) {
    const sub = f.getUint16(24, true); // first 2 bytes of SubFormat GUID
    // 1 = KSDATAFORMAT_SUBTYPE_PCM, 3 = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    if (sub !== 1 && sub !== 3)
      throw new Error("WAVE_FORMAT_EXTENSIBLE sub-format is neither PCM nor IEEE float.");
    formatTag = sub;
  } else if (formatTag !== 1 && formatTag !== 3) {
    throw new Error(
      "Unsupported wFormatTag 0x" + formatTag.toString(16) + " (PCM or IEEE float required).",
    );
  }
  format.formatTag = formatTag;
  if (formatTag === 3 && format.bitsPerSample !== 32 && format.bitsPerSample !== 64)
    throw new Error(`Unsupported float bit depth: ${format.bitsPerSample}.`);


  const chnaRef = find("chna");
  const chna: ChnaEntry[] = [];
  if (chnaRef) {
    const c = await readSlice(file, chnaRef.offset, chnaRef.size);
    const uidNum = c.getUint16(2, true);
    const bytes = new Uint8Array(c.buffer);
    for (let i = 0; i < uidNum; i++) {
      const p = 4 + i * 40;
      if (p + 40 > c.byteLength) break;
      const trackIndex = c.getUint16(p, true);
      const str = (s: number, len: number) => ascii.decode(bytes.subarray(p + s, p + s + len)).trim();
      const uid = str(2, 12);
      if (!uid || trackIndex === 0) continue;
      chna.push({ trackIndex, uid, trackRef: str(14, 14), packRef: str(28, 11) });
    }
  }

  const axmlRef = find("axml");
  let axml: string | null = null;
  if (axmlRef) {
    const buf = await file.slice(axmlRef.offset, axmlRef.offset + axmlRef.size).arrayBuffer();
    axml = dec.decode(new Uint8Array(buf));
  }

  const bytesPerFrame = format.blockAlign || format.channels * (format.bitsPerSample / 8);
  const frameCount =
    ds64SampleCount > 0 ? ds64SampleCount : Math.floor(dataRef.size / bytesPerFrame);

  return {
    isRF64,
    format,
    dataOffset: dataRef.offset,
    dataSize: dataRef.size,
    frameCount,
    durationSec: frameCount / format.sampleRate,
    chunks,
    chna,
    axml,
    hasDbmd: !!find("dbmd"),
  };
}
