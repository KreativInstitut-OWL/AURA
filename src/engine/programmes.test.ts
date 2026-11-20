import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { analyseAdm, mutedTracks, programmeFileTag } from "./adm";
import type { AdmProgramme, ContainerInfo } from "./types";

(globalThis as unknown as { DOMParser: unknown }).DOMParser = new Window().DOMParser;

// Same structure as Two_Language_Programmes_ADM_Test_File.wav
const axml = `<?xml version="1.0"?><ebuCoreMain xmlns="urn:ebu:metadata-schema:ebuCore"><coreMetadata><format><audioFormatExtended>
<audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="DocumentaryEnglish" audioProgrammeLanguage="en"><audioContentIDRef>ACO_1001</audioContentIDRef><audioContentIDRef>ACO_1003</audioContentIDRef></audioProgramme>
<audioProgramme audioProgrammeID="APR_1002" audioProgrammeName="DocumentaryGerman" audioProgrammeLanguage="de"><audioContentIDRef>ACO_1002</audioContentIDRef><audioContentIDRef>ACO_1003</audioContentIDRef></audioProgramme>
<audioContent audioContentID="ACO_1001"><audioObjectIDRef>AO_1001</audioObjectIDRef></audioContent>
<audioContent audioContentID="ACO_1002"><audioObjectIDRef>AO_1002</audioObjectIDRef></audioContent>
<audioContent audioContentID="ACO_1003"><audioObjectIDRef>AO_1003</audioObjectIDRef></audioContent>
<audioObject audioObjectID="AO_1001"><audioTrackUIDRef>ATU_00000001</audioTrackUIDRef></audioObject>
<audioObject audioObjectID="AO_1002"><audioTrackUIDRef>ATU_00000002</audioTrackUIDRef></audioObject>
<audioObject audioObjectID="AO_1003"><audioTrackUIDRef>ATU_00000003</audioTrackUIDRef><audioTrackUIDRef>ATU_00000004</audioTrackUIDRef></audioObject>
<audioTrackUID UID="ATU_00000001"/><audioTrackUID UID="ATU_00000002"/><audioTrackUID UID="ATU_00000003"/><audioTrackUID UID="ATU_00000004"/>
</audioFormatExtended></format></coreMetadata></ebuCoreMain>`;

const container = {
  format: { channels: 4, sampleRate: 48000, bitsPerSample: 24 },
  chna: [
    { trackIndex: 1, uid: "ATU_00000001", trackRef: "AT_00010003_01", packRef: "AP_00010001" },
    { trackIndex: 2, uid: "ATU_00000002", trackRef: "AT_00010003_01", packRef: "AP_00010001" },
    { trackIndex: 3, uid: "ATU_00000003", trackRef: "AT_00010001_01", packRef: "AP_00010002" },
    { trackIndex: 4, uid: "ATU_00000004", trackRef: "AT_00010002_01", packRef: "AP_00010002" },
  ],
  axml,
} as unknown as ContainerInfo;

test("two-language file resolves each programme to its tracks", () => {
  const r = analyseAdm(container, "dolby");
  expect(r.programmes.map((p) => [p.name, p.language, p.trackIndices])).toEqual([
    ["DocumentaryEnglish", "en", [0, 2, 3]],
    ["DocumentaryGerman", "de", [1, 2, 3]],
  ]);
  expect([...mutedTracks(r.programmes, "APR_1002", 4)]).toEqual([0]);
  expect([...mutedTracks(r.programmes, null, 4)]).toEqual([1]);
});

test("filename tag uses the sanitised programme name without stray underscores", () => {
  const progs: AdmProgramme[] = [
    { id: "a", name: " -Doku: Deutsch! ", language: "de", trackIndices: [0] },
    { id: "b", name: "Other", language: null, trackIndices: [1] },
  ];
  expect(programmeFileTag(progs, "a")).toBe("_Doku_Deutsch");
});

test("single-programme files get no tag and nothing muted", () => {
  const one: AdmProgramme[] = [{ id: "a", name: "Main", language: "en", trackIndices: [0] }];
  expect(programmeFileTag(one, "a")).toBe("");
  expect(mutedTracks(one, "a", 5).size).toBe(0);
  expect(programmeFileTag([], null)).toBe("");
});

test("multi-programme selection excludes ancillary channels but retains shared tracks", () => {
  const programmes = analyseAdm(container).programmes;
  expect([...mutedTracks(programmes, "APR_1002", 5)]).toEqual([0, 4]);
});
test("invalid programme selection falls back to first programme", () => {
  expect([...mutedTracks(analyseAdm(container).programmes, "missing", 5)]).toEqual([1, 4]);
});
test("no programmes leave all channels active", () => {
  expect(mutedTracks([], null, 5).size).toBe(0);
});
