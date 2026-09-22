import {
  COMMON_CHANNELS,
  commonChannel,
  commonPack,
  isCommonId,
  type CommonChannel,
} from "./common-definitions";
import { cartesianToPolar, deg2rad } from "./sh";
import type {
  AnalysisResult,
  BedProfile,
  ContainerInfo,
  RenderSource,
  ResolutionStep,
  TrackDiagnostic,
  TrajectoryPoint,
} from "./types";

export interface BedGeometry {
  az: number;
  el: number;
  label: string;
}

/** Dolby Atmos studio reference geometry (azimuth +, elevation in degrees). */
export const DOLBY_BED_LAYOUT: Record<string, BedGeometry> = {
  L: { az: 30, el: 0, label: "L" },
  R: { az: -30, el: 0, label: "R" },
  C: { az: 0, el: 0, label: "C" },
  LFE: { az: 0, el: -90, label: "LFE" },
  Lw: { az: 45, el: 0, label: "Lw" },
  Rw: { az: -45, el: 0, label: "Rw" },
  Lss: { az: 100, el: 0, label: "Lss" },
  Rss: { az: -100, el: 0, label: "Rss" },
  Lrs: { az: 135, el: 0, label: "Lrs" },
  Rrs: { az: -135, el: 0, label: "Rrs" },
  Ltf: { az: 45, el: 45, label: "Ltf" },
  Rtf: { az: -45, el: 45, label: "Rtf" },
  Ltm: { az: 90, el: 45, label: "Ltm" },
  Rtm: { az: -90, el: 45, label: "Rtm" },
  Ltr: { az: 135, el: 45, label: "Ltr" },
  Rtr: { az: -135, el: 45, label: "Rtr" },
};

/** ITU-R BS.2051 / BS.2094 nominal geometry for the same roles. */
export const ITU_BED_LAYOUT: Record<string, BedGeometry> = {
  L: { az: 30, el: 0, label: "M+030" },
  R: { az: -30, el: 0, label: "M-030" },
  C: { az: 0, el: 0, label: "M+000" },
  LFE: { az: 0, el: -30, label: "LFE" },
  Lw: { az: 60, el: 0, label: "M+060" },
  Rw: { az: -60, el: 0, label: "M-060" },
  Lss: { az: 90, el: 0, label: "M+090" },
  Rss: { az: -90, el: 0, label: "M-090" },
  Lrs: { az: 135, el: 0, label: "M+135" },
  Rrs: { az: -135, el: 0, label: "M-135" },
  Ltf: { az: 45, el: 30, label: "U+045" },
  Rtf: { az: -45, el: 30, label: "U-045" },
  Ltm: { az: 90, el: 30, label: "U+090" },
  Rtm: { az: -90, el: 30, label: "U-090" },
  Ltr: { az: 135, el: 30, label: "U+135" },
  Rtr: { az: -135, el: 30, label: "U-135" },

};

export const BED_PROFILES: Record<BedProfile, Record<string, BedGeometry>> = {
  dolby: DOLBY_BED_LAYOUT,
  itu: ITU_BED_LAYOUT,
};

export const BED_PROFILE_LABEL: Record<BedProfile, string> = {
  dolby: "Dolby Atmos reference",
  itu: "ITU-R BS.2051 / BS.2094",
};

/** Back-compat alias — the Dolby layout is the default. */
export const BED_LAYOUT = DOLBY_BED_LAYOUT;

export const BED_ORDER = ["L", "R", "C", "LFE", "Lss", "Rss", "Lrs", "Rrs", "Ltm", "Rtm"];

/** BS.2051 speaker labels (and Dolby shorthands) to bed/speaker roles. */
const LABEL_TO_ROLE: Record<string, string> = {
  "M+030": "L",
  "M-030": "R",
  "M+000": "C",
  LFE: "LFE",
  LFE1: "LFE",
  LFE2: "LFE",
  "M+060": "Lw",
  "M-060": "Rw",
  "M+045": "Lw",
  "M-045": "Rw",
  "M+090": "Lss",
  "M-090": "Rss",
  "M+100": "Lss",
  "M-100": "Rss",
  "M+110": "Lrs",
  "M-110": "Rrs",
  "M+135": "Lrs",
  "M-135": "Rrs",
  "U+045": "Ltf",
  "U-045": "Rtf",
  "U+030": "Ltf",
  "U-030": "Rtf",
  "U+090": "Ltm",
  "U-090": "Rtm",
  "U+135": "Ltr",
  "U-135": "Rtr",
  "U+110": "Ltr",
  "U-110": "Rtr",
  L: "L",
  R: "R",
  C: "C",
  LW: "Lw",
  RW: "Rw",
  LS: "Lss",
  RS: "Rss",
  LSS: "Lss",
  RSS: "Rss",
  LRS: "Lrs",
  RRS: "Rrs",
  LSR: "Lrs",
  RSR: "Rrs",
  LTF: "Ltf",
  RTF: "Rtf",
  LTM: "Ltm",
  RTM: "Rtm",
  LTR: "Ltr",
  RTR: "Rtr",
  LTS: "Ltm",
  RTS: "Rtm",
  LFS: "Ltf",
  RFS: "Rtf",
  LRSS: "Lrs",
  RRSS: "Rrs",
};


function roleFromLabel(raw: string | null): string | null {
  if (!raw) return null;
  const tail = raw.split(":").pop() ?? raw;
  const clean = tail.replace(/^RC_/, "").trim();
  return LABEL_TO_ROLE[clean] ?? LABEL_TO_ROLE[clean.toUpperCase()] ?? null;
}

/** Parses ADM timecode "hh:mm:ss.fffff" or "hh:mm:ss.fffffSnnnnn" to samples. */
export function admTimeToSamples(value: string | null, sampleRate: number): number {
  if (!value) return 0;
  const v = value.trim();
  const sampleForm = /^(\d+):(\d+):(\d+)\.(\d+)S(\d+)$/.exec(v);
  if (sampleForm) {
    const [, h, m, s, num, den] = sampleForm;
    const frac = Number(num) / Number(den);
    return Math.round(((Number(h) * 3600 + Number(m) * 60 + Number(s)) + frac) * sampleRate);
  }
  const clock = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(v);
  if (clock) {
    const [, h, m, s, frac] = clock;
    const f = frac ? Number("0." + frac) : 0;
    return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s) + f) * sampleRate);
  }
  const asNumber = Number(v);
  return Number.isFinite(asNumber) ? Math.round(asNumber * sampleRate) : 0;
}

const text = (el: Element | null | undefined): string | null =>
  el && el.textContent != null ? el.textContent.trim() : null;

function child(parent: Element, localName: string): Element | null {
  for (const node of Array.from(parent.children)) {
    if (node.localName === localName) return node;
  }
  return null;
}

function children(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((n) => n.localName === localName);
}

function allByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((n) => n.localName === localName);
}

interface ChannelFormatModel {
  id: string;
  name: string;
  type: string; // "0001" DirectSpeakers, "0003" Objects, ...
  role: string | null;
  blocks: {
    rtime: string | null;
    duration: string | null;
    cartesian: boolean;
    az: number;
    el: number;
    dist: number;
    gain: number;
    jump: boolean;
    speakerLabel: string | null;
  }[];
}

function parseBlock(block: Element) {
  const cartesianFlag = text(child(block, "cartesian")) === "1";
  let az = 0;
  let el = 0;
  let dist = 1;

  const positions = children(block, "position");
  const byCoord: Record<string, number> = {};
  for (const p of positions) {
    const coord = p.getAttribute("coordinate");
    const val = Number(text(p) ?? "0");
    if (coord) byCoord[coord] = Number.isFinite(val) ? val : 0;
  }

  const hasCart = "X" in byCoord || "Y" in byCoord || "Z" in byCoord;
  const hasPolar =
    "azimuth" in byCoord || !!child(block, "azimuth") || "elevation" in byCoord;
  let positionSource: "polar" | "room" | "none" = "none";
  if (hasPolar) {
    // Explicit polar angles always win, even when cartesian="1" is also set.
    const azDeg = byCoord['azimuth'] ?? Number(text(child(block, "azimuth")) ?? "0");
    const elDeg = byCoord['elevation'] ?? Number(text(child(block, "elevation")) ?? "0");
    const d = byCoord['distance'] ?? Number(text(child(block, "distance")) ?? "1");
    az = deg2rad(Number.isFinite(azDeg) ? azDeg : 0);
    el = deg2rad(Number.isFinite(elDeg) ? elDeg : 0);
    dist = Number.isFinite(d) && d > 0 ? d : 1;
    positionSource = "polar";
  } else if (hasCart) {
    // Dolby room-box coordinates: aspect-corrected azimuth, perimeter elevation.
    const polar = roomCartesianToPolar(
      byCoord['X'] ?? 0,
      byCoord['Y'] ?? 0,
      byCoord['Z'] ?? 0,
    );
    az = polar.azimuth;
    el = polar.elevation;
    dist = polar.distance;
    positionSource = "room";
  }


  const gainEl = child(block, "gain");
  let gain = 1;
  if (gainEl) {
    const raw = Number(text(gainEl) ?? "1");
    gain =
      gainEl.getAttribute("gainUnit") === "dB"
        ? Math.pow(10, (Number.isFinite(raw) ? raw : 0) / 20)
        : Number.isFinite(raw)
          ? raw
          : 1;
  }

  const jumpEl = child(block, "jumpPosition");
  return {
    rtime: block.getAttribute("rtime"),
    duration: block.getAttribute("duration"),
    cartesian: cartesianFlag,
    az,
    el,
    dist,
    gain,
    jump: !!jumpEl && text(jumpEl) === "1",
    speakerLabel: text(child(block, "speakerLabel")),
  };
}

/**
 * Parses the axml (ITU-R BS.2076) chunk and combines it with the chna table
 * into a flat list of render sources (one per physical WAV track).
 */
export function analyseAdm(
  container: ContainerInfo,
  profile: BedProfile = "dolby",
): AnalysisResult {
  const warnings: string[] = [];
  const layout = BED_PROFILES[profile];
  const profileName = BED_PROFILE_LABEL[profile];
  const sampleRate = container.format.sampleRate;
  const sources: RenderSource[] = [];
  const diagnostics: TrackDiagnostic[] = [];
  let programmeName: string | null = null;

  if (container.hasDbmd) warnings.push("Proprietary 'dbmd' chunk found — ignored by design.");

  if (!container.axml || container.chna.length === 0) {
    warnings.push(
      "No usable axml/chna metadata — falling back to a channel-order 7.1.2 bed mapping.",
    );
    const n = Math.min(container.format.channels, BED_ORDER.length);
    for (let i = 0; i < n; i++) {
      const role = BED_ORDER[i]!;
      const geo = layout[role]!;
      sources.push({
        channelIndex: i,
        kind: "bed",
        name: role,
        uid: `CH_${i + 1}`,
        isLFE: role === "LFE",
        azimuth: deg2rad(geo.az),
        elevation: deg2rad(geo.el),
        gain: 1,
        points: [],
      });
      diagnostics.push({
        trackIndex: i + 1,
        uid: `CH_${i + 1}`,
        status: "bed",
        guessed: true,
        name: role,
        detail: `No ADM metadata — assumed from channel order (${profileName}).`,
        steps: [{ label: "metadata", value: "none", ok: false }],
      });
    }
    return { container, sources, warnings, programmeName, diagnostics };
  }

  const doc = new DOMParser().parseFromString(container.axml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The axml chunk is not well-formed XML.");
  }

  programmeName = allByLocalName(doc, "audioProgramme")[0]?.getAttribute("audioProgrammeName") ?? null;

  // audioChannelFormat index
  const channelFormats = new Map<string, ChannelFormatModel>();
  for (const cf of allByLocalName(doc, "audioChannelFormat")) {
    const id = cf.getAttribute("audioChannelFormatID") ?? "";
    const typeAttr =
      cf.getAttribute("typeLabel") ??
      (cf.getAttribute("typeDefinition") === "Objects"
        ? "0003"
        : cf.getAttribute("typeDefinition") === "DirectSpeakers"
          ? "0001"
          : "");
    const blocks = children(cf, "audioBlockFormat").map(parseBlock);
    channelFormats.set(id, {
      id,
      name: cf.getAttribute("audioChannelFormatName") ?? id,
      type: typeAttr,
      role: roleFromLabel(blocks[0]?.speakerLabel ?? cf.getAttribute("audioChannelFormatName")),
      blocks,
    });
  }

  // audioTrackFormat -> audioStreamFormat -> audioChannelFormat reference chain
  const trackFormatToStream = new Map<string, string>();
  const streamToChannel = new Map<string, string>();
  for (const tf of allByLocalName(doc, "audioTrackFormat")) {
    const id = tf.getAttribute("audioTrackFormatID") ?? "";
    const ref = text(child(tf, "audioStreamFormatIDRef"));
    if (id && ref) trackFormatToStream.set(id, ref);
  }
  for (const sf of allByLocalName(doc, "audioStreamFormat")) {
    const id = sf.getAttribute("audioStreamFormatID") ?? "";
    const cfRef = text(child(sf, "audioChannelFormatIDRef"));
    if (id && cfRef) streamToChannel.set(id, cfRef);
    // audioStreamFormat can also point back at its track formats
    for (const tfRefEl of children(sf, "audioTrackFormatIDRef")) {
      const tfRef = text(tfRefEl);
      if (tfRef && id && !trackFormatToStream.has(tfRef)) trackFormatToStream.set(tfRef, id);
    }
  }

  // audioPackFormat -> ordered channel formats (file-local packs)
  const packToChannels = new Map<string, string[]>();
  for (const pf of allByLocalName(doc, "audioPackFormat")) {
    const id = pf.getAttribute("audioPackFormatID") ?? "";
    const refs = children(pf, "audioChannelFormatIDRef")
      .map((r) => text(r))
      .filter((r): r is string => !!r);
    if (id && refs.length) packToChannels.set(id, refs);
  }

  // audioTrackUID -> its own references
  interface UidRefs {
    channelFormat: string | null;
    trackFormat: string | null;
    pack: string | null;
  }
  const uidRefs = new Map<string, UidRefs>();
  for (const tu of allByLocalName(doc, "audioTrackUID")) {
    const uid = tu.getAttribute("UID") ?? "";
    if (!uid) continue;
    uidRefs.set(uid, {
      channelFormat: text(child(tu, "audioChannelFormatIDRef")),
      trackFormat: text(child(tu, "audioTrackFormatIDRef")),
      pack: text(child(tu, "audioPackFormatIDRef")),
    });
  }

  // audioObject names, resolved through their track UID references
  const uidToObjectName = new Map<string, string>();
  for (const ao of allByLocalName(doc, "audioObject")) {
    const name = ao.getAttribute("audioObjectName") ?? ao.getAttribute("audioObjectID") ?? "Object";
    for (const ref of children(ao, "audioTrackUIDRef")) {
      const uid = text(ref);
      if (uid) uidToObjectName.set(uid, name);
    }
  }

  // Position of each track inside its pack, used only for the labelled fallback.
  const packSeen = new Map<string, number>();
  const packPosition = new Map<string, number>();
  for (const entry of container.chna) {
    const packId = (uidRefs.get(entry.uid)?.pack ?? entry.packRef ?? "").trim();
    if (!packId) continue;
    const n = packSeen.get(packId) ?? 0;
    packPosition.set(entry.uid, n);
    packSeen.set(packId, n + 1);
  }

  let unresolvedCount = 0;

  for (const entry of container.chna) {
    const channelIndex = entry.trackIndex - 1;
    if (channelIndex < 0 || channelIndex >= container.format.channels) continue;

    const refs = uidRefs.get(entry.uid);
    const steps: ResolutionStep[] = [
      { label: "audioTrackUID", value: entry.uid, ok: !!refs },
    ];

    // 1. direct shortcut (BS.2076-2)
    let cfId = refs?.channelFormat?.trim() || null;
    if (cfId) steps.push({ label: "direct channelFormatIDRef", value: cfId, ok: true });

    // 2. classic chain: trackFormat -> streamFormat -> channelFormat
    if (!cfId) {
      const tfId = (refs?.trackFormat ?? entry.trackRef ?? "").trim() || null;
      steps.push({
        label: "audioTrackFormatIDRef",
        value: tfId ?? "missing",
        ok: !!tfId,
      });
      if (tfId) {
        const sfId = trackFormatToStream.get(tfId) ?? null;
        steps.push({ label: "audioStreamFormat", value: sfId ?? "not found", ok: !!sfId });
        if (sfId) {
          cfId = streamToChannel.get(sfId) ?? null;
          steps.push({
            label: "audioChannelFormatIDRef",
            value: cfId ?? "not found",
            ok: !!cfId,
          });
        }
        // Common-definition track formats are named AT_<channelFormatID>_<nn>,
        // so the channel ID can be derived when the chain isn't in the file.
        if (!cfId) {
          const m = /^AT_(0001[0-9a-fA-F]{4})_/.exec(tfId);
          if (m) {
            cfId = `AC_${m[1]!.toLowerCase()}`;
            steps.push({
              label: "common-definition track format",
              value: `${tfId} → ${cfId}`,
              ok: true,
            });
          }
        }
      }
    }

    const packId = (refs?.pack ?? entry.packRef ?? "").trim() || null;
    let guessed = false;

    // 3. labelled fallback: take the channel at this track's position in a known pack
    if (!cfId && packId) {
      const list = packToChannels.get(packId) ?? commonPack(packId)?.channels;
      const pos = packPosition.get(entry.uid);
      const fallback = list && pos != null ? list[pos] : undefined;
      if (fallback) {
        cfId = fallback;
        guessed = true;
        steps.push({
          label: "pack-order fallback",
          value: `${packId}[${pos}] → ${fallback}`,
          ok: true,
        });
      } else {
        steps.push({ label: "audioPackFormatIDRef", value: packId, ok: false });
      }
    }

    const cf = cfId ? channelFormats.get(cfId) : undefined;
    const common = cfId && !cf ? commonChannel(cfId) : undefined;
    const displayName =
      uidToObjectName.get(entry.uid) ?? cf?.name ?? common?.name ?? `Track ${entry.trackIndex}`;

    if (cfId && !cf && !common) {
      steps.push({ label: "definition", value: `${cfId} unknown`, ok: false });
    } else if (common) {
      steps.push({
        label: "common definition",
        value: `${common.id} ${common.name} (${common.label})`,
        ok: true,
      });
    }

    const fail = (detail: string) => {
      unresolvedCount++;
      diagnostics.push({
        trackIndex: entry.trackIndex,
        uid: entry.uid,
        status: "unresolved",
        guessed: false,
        name: displayName,
        detail,
        steps,
      });
    };

    if (!cfId) {
      fail("No channel definition could be reached from this track.");
      continue;
    }

    // --- Common-definition bed channel -------------------------------------
    if (common) {
      // The catalogue gives the ITU nominal angles. In Dolby mode the matching
      // 7.1.2 role is placed at the Dolby Atmos studio reference angles instead.
      const commonRole = roleFromLabel(common.label) ?? roleFromLabel(common.name);
      const geo = commonRole ? layout[commonRole] : undefined;
      const azDeg = geo ? geo.az : common.azimuth;
      const elDeg = geo ? geo.el : common.elevation;
      const name = commonRole ?? common.label ?? common.name;
      sources.push({
        channelIndex,
        kind: "bed",
        name,
        uid: entry.uid,
        isLFE: common.label.toUpperCase().startsWith("LFE"),
        azimuth: deg2rad(azDeg),
        elevation: deg2rad(elDeg),
        gain: 1,
        points: [],
      });
      diagnostics.push({
        trackIndex: entry.trackIndex,
        uid: entry.uid,
        status: "bed",
        guessed,
        name,
        detail: `${common.name} (${common.label}) at ${azDeg}° / ${elDeg}° — ${profileName}`,
        steps,
      });
      continue;
    }

    if (!cf) {
      if (isCommonId(cfId)) {
        warnings.push(
          `Track ${entry.trackIndex} (${entry.uid}) cites unknown catalogue number ${cfId} — not in the ITU common definitions. Skipped.`,
        );
        fail(`Unknown catalogue number ${cfId}.`);
      } else {
        fail(`Channel definition ${cfId} is not present in the file.`);
      }
      continue;
    }

    const isDirect = cf.type === "0001" || cf.role !== null;
    if (isDirect) {
      const block = cf.blocks[0];
      const role = cf.role;
      const fromLabel = roleFromLabel(block?.speakerLabel ?? null);
      const labelCommon = (Object.values(COMMON_CHANNELS) as CommonChannel[]).find(
        (c) => c.label === (block?.speakerLabel ?? "").split(":").pop(),
      );
      // A recognised 7.1.2 role is always placed at the active profile's
      // reference angle; anything else keeps the position written in the file.
      const bedRole = role ?? fromLabel ?? roleFromLabel(labelCommon?.label ?? null);
      const geo = bedRole ? layout[bedRole] : undefined;
      let az: number | null = null;
      let el: number | null = null;
      let how = "";
      // Priority 1: explicit non-zero coordinates written in the file.
      if (block && (block.az !== 0 || block.el !== 0)) {
        az = block.az;
        el = block.el;
        how = "explicit position in file";
      } else if (geo) {
        // Priority 2: recognised 7.1.2 role at the active profile's reference angle.
        az = deg2rad(geo.az);
        el = deg2rad(geo.el);
        how = `${bedRole} at ${profileName}`;
      } else if (labelCommon) {
        az = deg2rad(labelCommon.azimuth);
        el = deg2rad(labelCommon.elevation);
        how = `speaker label ${labelCommon.label}`;
      } else if (block) {
        az = block.az;
        el = block.el;
        how = "position in file";
      }

      if (az == null || el == null) {
        warnings.push(
          `Track ${entry.trackIndex} (${entry.uid}) is a bed channel with no usable speaker position — skipped.`,
        );
        fail("Bed channel without a usable speaker position.");
        continue;
      }

      const isLFE =
        role === "LFE" ||
        (block?.speakerLabel ?? "").toUpperCase().includes("LFE") ||
        cf.name.toUpperCase().includes("LFE");

      const name = role ?? labelCommon?.label ?? fromLabel ?? cf.name;
      sources.push({
        channelIndex,
        kind: "bed",
        name,
        uid: entry.uid,
        isLFE,
        azimuth: az,
        elevation: el,
        gain: block?.gain ?? 1,
        points: [],
      });
      diagnostics.push({
        trackIndex: entry.trackIndex,
        uid: entry.uid,
        status: "bed",
        guessed,
        name,
        detail: `${how} — ${((az * 180) / Math.PI).toFixed(1)}° / ${((el * 180) / Math.PI).toFixed(1)}°`,
        steps,
      });
      continue;
    }

    // Object: build the keyframe trajectory
    const points: TrajectoryPoint[] = [];
    for (const b of cf.blocks) {
      const start = admTimeToSamples(b.rtime, sampleRate);
      const dur = b.duration ? admTimeToSamples(b.duration, sampleRate) : 0;
      points.push({
        start,
        end: dur > 0 ? start + dur : start,
        azimuth: b.az,
        elevation: b.el,
        distance: b.dist,
        gain: b.gain,
        jump: b.jump,
      });
    }
    points.sort((a, b) => a.start - b.start);
    if (points.length === 0) {
      points.push({
        start: 0,
        end: container.frameCount,
        azimuth: 0,
        elevation: 0,
        distance: 1,
        gain: 1,
        jump: false,
      });
    }
    sources.push({
      channelIndex,
      kind: "object",
      name: displayName,
      uid: entry.uid,
      isLFE: false,
      azimuth: points[0]!.azimuth,
      elevation: points[0]!.elevation,
      gain: 1,
      points,
    });
    diagnostics.push({
      trackIndex: entry.trackIndex,
      uid: entry.uid,
      status: "object",
      guessed,
      name: displayName,
      detail: `${points.length} keyframe${points.length === 1 ? "" : "s"}`,
      steps,
    });
  }

  const guessedTracks = diagnostics.filter((d) => d.guessed);
  if (guessedTracks.length > 0) {
    warnings.push(
      `${guessedTracks.length} track${guessedTracks.length === 1 ? "" : "s"} had no direct channel definition — positions were inferred from the pack layout order (labelled as a guess in the inspector).`,
    );
  }
  if (unresolvedCount > 0) {
    warnings.push(
      `${unresolvedCount} track${unresolvedCount === 1 ? " is" : "s are"} unresolved and will not be rendered — open the metadata inspector for the per-track trace.`,
    );
  }

  const beds = sources.filter((s) => s.kind === "bed");
  if (beds.length > 10) {
    warnings.push(`Bed has ${beds.length} channels; Dolby Atmos beds are capped at 7.1.2 (10 ch).`);
  }
  sources.sort((a, b) => a.channelIndex - b.channelIndex);
  diagnostics.sort((a, b) => a.trackIndex - b.trackIndex);
  return { container, sources, warnings, programmeName, diagnostics };
}

/** Position of an object at a given sample, with keyframe interpolation. */
export function positionAt(points: TrajectoryPoint[], sample: number) {
  const n = points.length;
  if (n === 0) return { azimuth: 0, elevation: 0, distance: 1, gain: 1 };
  if (sample <= points[0]!.start) return points[0]!;
  const last = points[n - 1]!;
  if (sample >= last.start) return last;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.start <= sample) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (b.jump || b.start <= a.start) return a;
  const t = (sample - a.start) / (b.start - a.start);

  // Shortest-arc spherical interpolation on azimuth, linear on elevation/distance.
  let dAz = b.azimuth - a.azimuth;
  while (dAz > Math.PI) dAz -= 2 * Math.PI;
  while (dAz < -Math.PI) dAz += 2 * Math.PI;

  return {
    azimuth: a.azimuth + dAz * t,
    elevation: a.elevation + (b.elevation - a.elevation) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    gain: a.gain + (b.gain - a.gain) * t,
  };
}
