import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { analyseAdm } from "./adm";
import type { ContainerInfo } from "./types";

(globalThis as unknown as { DOMParser: unknown }).DOMParser = new Window().DOMParser;

const axml = `<?xml version="1.0"?><ebuCoreMain><coreMetadata><format><audioFormatExtended>
<audioTrackUID UID="ATU_00000001"><audioChannelFormatIDRef>AC_00050001</audioChannelFormatIDRef></audioTrackUID>
<audioTrackUID UID="ATU_00000002"><audioChannelFormatIDRef>AT_00031001_01</audioChannelFormatIDRef></audioTrackUID>
</audioFormatExtended></format></coreMetadata></ebuCoreMain>`;

const container = {
  format: { channels: 2, sampleRate: 48000, bitsPerSample: 24 },
  chna: [
    { trackIndex: 1, uid: "ATU_00000001", trackRef: "", packRef: "" },
    { trackIndex: 2, uid: "ATU_00000002", trackRef: "", packRef: "" },
  ],
  axml,
} as unknown as ContainerInfo;

test("AC_00050001 resolves as a skipped binaural feed, not unresolved", () => {
  const r = analyseAdm(container, "itu");
  const bin = r.diagnostics.find((d) => d.trackIndex === 1)!;
  expect(bin.status).toBe("skipped");
  expect(bin.detail).toBe("Binaural headphone feed — not rendered into Ambisonics");
  expect(r.sources.some((s) => s.channelIndex === 0)).toBe(false);
});

test("skipped binaural tracks are not counted as unresolved; Dolby E gets a clear detail", () => {
  const r = analyseAdm(container, "itu");
  expect(r.diagnostics.find((d) => d.trackIndex === 2)!.detail).toBe(
    "Encoded data stream (e.g. Dolby E) or non-spatial track — not rendered",
  );
  expect(r.warnings.some((w) => w.startsWith("1 track is unresolved"))).toBe(true);
});
