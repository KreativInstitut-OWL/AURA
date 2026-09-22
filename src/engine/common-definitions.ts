// GENERATED from ITU-R BS.2094 common definitions (DirectSpeakers section).
// ADM files reference these standard channel/pack definitions by ID instead of
// writing them into the file, so the renderer has to carry its own copy.

export interface CommonChannel {
  id: string;
  name: string;
  /** BS.2051 speaker label, e.g. "M+030" */
  label: string;
  azimuth: number; // degrees, + = left
  elevation: number; // degrees, + = up
}

export const COMMON_CHANNELS: Record<string, CommonChannel> = {
  AC_00010001: { id: "AC_00010001", name: "FrontLeft", label: "M+030", azimuth: 30.0, elevation: 0.0 },
  AC_00010002: { id: "AC_00010002", name: "FrontRight", label: "M-030", azimuth: -30.0, elevation: 0.0 },
  AC_00010003: { id: "AC_00010003", name: "FrontCentre", label: "M+000", azimuth: 0.0, elevation: 0.0 },
  AC_00010004: { id: "AC_00010004", name: "LowFrequencyEffects", label: "LFE", azimuth: 0.0, elevation: -30.0 },
  AC_00010005: { id: "AC_00010005", name: "SurroundLeft", label: "M+110", azimuth: 110.0, elevation: 0.0 },
  AC_00010006: { id: "AC_00010006", name: "SurroundRight", label: "M-110", azimuth: -110.0, elevation: 0.0 },
  AC_00010007: { id: "AC_00010007", name: "FrontLeftOfCentre", label: "M+022", azimuth: 22.5, elevation: 0.0 },
  AC_00010008: { id: "AC_00010008", name: "FrontRightOfCentre", label: "M-022", azimuth: -22.5, elevation: 0.0 },
  AC_00010009: { id: "AC_00010009", name: "BackCentre", label: "M+180", azimuth: 180.0, elevation: 0.0 },
  AC_0001000a: { id: "AC_0001000a", name: "SideLeft", label: "M+090", azimuth: 90.0, elevation: 0.0 },
  AC_0001000b: { id: "AC_0001000b", name: "SideRight", label: "M-090", azimuth: -90.0, elevation: 0.0 },
  AC_0001000c: { id: "AC_0001000c", name: "TopCentre", label: "T+000", azimuth: 0.0, elevation: 90.0 },
  AC_0001000d: { id: "AC_0001000d", name: "TopFrontLeft", label: "U+030", azimuth: 30.0, elevation: 30.0 },
  AC_0001000e: { id: "AC_0001000e", name: "TopFrontCentre", label: "U+000", azimuth: 0.0, elevation: 30.0 },
  AC_0001000f: { id: "AC_0001000f", name: "TopFrontRight", label: "U-030", azimuth: -30.0, elevation: 30.0 },
  AC_00010010: { id: "AC_00010010", name: "TopSurroundLeft", label: "U+110", azimuth: 110.0, elevation: 30.0 },
  AC_00010011: { id: "AC_00010011", name: "TopBackCentre", label: "U+180", azimuth: 180.0, elevation: 30.0 },
  AC_00010012: { id: "AC_00010012", name: "TopSurroundRight", label: "U-110", azimuth: -110.0, elevation: 30.0 },
  AC_00010013: { id: "AC_00010013", name: "TopSideLeft", label: "U+090", azimuth: 90.0, elevation: 30.0 },
  AC_00010014: { id: "AC_00010014", name: "TopSideRight", label: "U-090", azimuth: -90.0, elevation: 30.0 },
  AC_00010015: { id: "AC_00010015", name: "BottomFrontCentre", label: "B+000", azimuth: 0.0, elevation: -30.0 },
  AC_00010016: { id: "AC_00010016", name: "BottomFrontLeftMid", label: "B+045", azimuth: 45.0, elevation: -30.0 },
  AC_00010017: { id: "AC_00010017", name: "BottomFrontRightMid", label: "B-045", azimuth: -45.0, elevation: -30.0 },
  AC_00010018: { id: "AC_00010018", name: "FrontLeftWide", label: "M+060", azimuth: 60.0, elevation: 0.0 },
  AC_00010019: { id: "AC_00010019", name: "FrontRightWide", label: "M-060", azimuth: -60.0, elevation: 0.0 },
  AC_0001001a: { id: "AC_0001001a", name: "BackLeftMidDiffuse", label: "M+135_Diff", azimuth: 135.0, elevation: 0.0 },
  AC_0001001b: { id: "AC_0001001b", name: "BackRightMidDiffuse", label: "M-135_Diff", azimuth: -135.0, elevation: 0.0 },
  AC_0001001c: { id: "AC_0001001c", name: "BackLeftMid", label: "M+135", azimuth: 135.0, elevation: 0.0 },
  AC_0001001d: { id: "AC_0001001d", name: "BackRightMid", label: "M-135", azimuth: -135.0, elevation: 0.0 },
  AC_0001001e: { id: "AC_0001001e", name: "TopBackLeftMid", label: "U+135", azimuth: 135.0, elevation: 30.0 },
  AC_0001001f: { id: "AC_0001001f", name: "TopBackRightMid", label: "U-135", azimuth: -135.0, elevation: 30.0 },
  AC_00010020: { id: "AC_00010020", name: "LowFrequencyEffectsL", label: "LFEL", azimuth: 45.0, elevation: -30.0 },
  AC_00010021: { id: "AC_00010021", name: "LowFrequencyEffectsR", label: "LFER", azimuth: -45.0, elevation: -30.0 },
  AC_00010022: { id: "AC_00010022", name: "TopFrontLeftMid", label: "U+045", azimuth: 45.0, elevation: 30.0 },
  AC_00010023: { id: "AC_00010023", name: "TopFrontRightMid", label: "U-045", azimuth: -45.0, elevation: 30.0 },
  AC_00010024: { id: "AC_00010024", name: "FrontLeftScreen", label: "M+SC", azimuth: 25.0, elevation: 0.0 },
  AC_00010025: { id: "AC_00010025", name: "FrontRightScreen", label: "M-SC", azimuth: -25.0, elevation: 0.0 },
  AC_00010026: { id: "AC_00010026", name: "FrontLeftMid", label: "M+045", azimuth: 45.0, elevation: 0.0 },
  AC_00010027: { id: "AC_00010027", name: "FrontRightMid", label: "M-045", azimuth: -45.0, elevation: 0.0 },
  AC_00010028: { id: "AC_00010028", name: "UpperTopBackCentre", label: "UH+180", azimuth: 180.0, elevation: 45.0 },
};

export const COMMON_PACKS: Record<string, { id: string; name: string; channels: string[] }> = {
  AP_00010001: { id: "AP_00010001", name: "urn:itu:bs:775:3:pack:mono_(0+1+0)", channels: ["AC_00010003"] },
  AP_00010002: { id: "AP_00010002", name: "urn:itu:bs:2051:0:pack:stereo_(0+2+0)", channels: ["AC_00010001", "AC_00010002"] },
  AP_0001000a: { id: "AP_0001000a", name: "urn:itu:bs:775:3:pack:3.0_(0+3+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003"] },
  AP_0001000b: { id: "AP_0001000b", name: "urn:itu:bs:775:3:pack:4.0_(0+4+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010009"] },
  AP_0001000c: { id: "AP_0001000c", name: "urn:itu:bs:2051:0:pack:5.0_(0+5+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010005", "AC_00010006"] },
  AP_00010003: { id: "AP_00010003", name: "urn:itu:bs:2051:0:pack:5.1_(0+5+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006"] },
  AP_0001000d: { id: "AP_0001000d", name: "6.1_(0+6+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_00010009"] },
  AP_0001000e: { id: "AP_0001000e", name: "7.1front_(0+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_00010026", "AC_00010027"] },
  AP_0001000f: { id: "AP_0001000f", name: "7.1back_(0+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_0001000a", "AC_0001000b", "AC_0001001c", "AC_0001001d"] },
  AP_00010004: { id: "AP_00010004", name: "urn:itu:bs:2051:0:pack:7.1top_(2+5+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_0001000d", "AC_0001000f"] },
  AP_00010012: { id: "AP_00010012", name: "7.1side_5.1+sc_(0+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_00010024", "AC_00010025"] },
  AP_00010013: { id: "AP_00010013", name: "7.1topside_5.1.2_(2+5+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_00010013", "AC_00010014"] },
  AP_00010014: { id: "AP_00010014", name: "9.1screen_5.1.2+sc_(2+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_00010013", "AC_00010014", "AC_00010024", "AC_00010025"] },
  AP_00010016: { id: "AP_00010016", name: "9.1_7.1.2_(2+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_0001000b", "AC_0001000c", "AC_0001001c", "AC_0001001d", "AC_00010013", "AC_00010014"] },
  AP_00010005: { id: "AP_00010005", name: "urn:itu:bs:2051:0:pack:9.1_5.1.4_(4+5+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_0001000d", "AC_0001000f", "AC_00010010", "AC_00010012"] },
  AP_00010010: { id: "AP_00010010", name: "urn:itu:bs:2051:0:pack:10.1_(4+5+1)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_0001000d", "AC_0001000f", "AC_00010010", "AC_00010012", "AC_00010015"] },
  AP_00010007: { id: "AP_00010007", name: "urn:itu:bs:2051:0:pack:10.2_(3+7+0)", channels: ["AC_00010003", "AC_00010001", "AC_00010002", "AC_00010022", "AC_00010023", "AC_0001000a", "AC_0001000b", "AC_0001001c", "AC_0001001d", "AC_00010028", "AC_00010020", "AC_00010021"] },
  AP_00010015: { id: "AP_00010015", name: "11.1_5.1.4+sc_(4+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_0001000d", "AC_0001000f", "AC_00010010", "AC_00010012", "AC_00010024", "AC_00010025"] },
  AP_00010017: { id: "AP_00010017", name: "11.1_7.1.4_(4+7+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_0001000a", "AC_0001000b", "AC_0001001c", "AC_0001001d", "AC_00010022", "AC_00010023", "AC_0001001e", "AC_0001001f"] },
  AP_00010008: { id: "AP_00010008", name: "urn:itu:bs:2051:0:pack:13.1_(4+9+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_0001000a", "AC_0001000b", "AC_0001001c", "AC_0001001d", "AC_00010022", "AC_00010023", "AC_0001001e", "AC_0001001f", "AC_00010024", "AC_00010025"] },
  AP_00010009: { id: "AP_00010009", name: "urn:itu:bs:2051:0:pack:22.2_(9+10+3)", channels: ["AC_00010018", "AC_00010019", "AC_00010003", "AC_00010020", "AC_0001001c", "AC_0001001d", "AC_00010001", "AC_00010002", "AC_00010009", "AC_00010021", "AC_0001000a", "AC_0001000b", "AC_00010022", "AC_00010023", "AC_0001000e", "AC_0001000c", "AC_0001001e", "AC_0001001f", "AC_00010013", "AC_00010014", "AC_00010011", "AC_00010015", "AC_00010016", "AC_00010017"] },
  AP_00010011: { id: "AP_00010011", name: "Auro-3D_(9+9+0)", channels: ["AC_00010001", "AC_00010002", "AC_00010003", "AC_00010004", "AC_00010005", "AC_00010006", "AC_0001000a", "AC_0001000b", "AC_0001001a", "AC_0001001b", "AC_0001000d", "AC_0001000f", "AC_0001000e", "AC_00010010", "AC_00010012", "AC_00010013", "AC_00010014", "AC_0001001e", "AC_0001001f"] },
};

/** Case-insensitive lookup — some writers emit lowercase or uppercase hex IDs. */
function lookup<T>(table: Record<string, T>, id: string | null | undefined): T | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  const direct = table[trimmed];
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return table[key];
  }
  return undefined;
}

export const commonChannel = (id: string | null | undefined) => lookup(COMMON_CHANNELS, id);
export const commonPack = (id: string | null | undefined) => lookup(COMMON_PACKS, id);

/** True for any ID in the common-definitions ranges (AC_0001xxxx / AP_0001xxxx). */
export const isCommonId = (id: string | null | undefined) =>
  !!id && /^A[CP]_0001[0-9a-fA-F]{4}$/.test(id.trim());
