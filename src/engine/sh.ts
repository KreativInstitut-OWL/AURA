/**
 * Real spherical harmonics, ACN channel ordering, SN3D normalization (AmbiX).
 *
 * ACN: k = n*(n+1) + m   ->   n = floor(sqrt(k)),  m = k - n*(n+1)
 * SN3D: S_n^m = sqrt((2 - delta_{m,0}) * (n-|m|)! / (n+|m|)!)
 *
 * The Condon-Shortley phase (-1)^m is deliberately OMITTED (AmbiX / RFC 8486 /
 * ITU-R BS.2076). The Legendre recurrences below are written in their
 * CS-free form, so no sign flip is ever introduced.
 */

export type AmbiOrder = 3 | 5 | 7;

export const channelCount = (order: number): number => (order + 1) * (order + 1);

export const acnDegree = (k: number): number => Math.floor(Math.sqrt(k));
export const acnIndex = (k: number): number => {
  const n = acnDegree(k);
  return k - n * (n + 1);
};

const factorial = (() => {
  const f = [1];
  for (let i = 1; i <= 40; i++) f[i] = f[i - 1]! * i;
  return f;
})();

/** Schmidt semi-normalization factor (SN3D). */
export function sn3d(n: number, m: number): number {
  const am = Math.abs(m);
  if (am === 0) return 1;
  return Math.sqrt((2 * factorial[n - am]!) / factorial[n + am]!);
}

const MAX_ORDER = 7;
const N_CH = channelCount(MAX_ORDER);

// Precomputed normalization per ACN channel.
const NORM = new Float64Array(N_CH);
for (let k = 0; k < N_CH; k++) NORM[k] = sn3d(acnDegree(k), acnIndex(k));

/**
 * Associated Legendre functions P_n^m(x) WITHOUT the Condon-Shortley phase.
 * Filled into `p` indexed by [n*(MAX_ORDER+1)+m].
 */
function legendre(order: number, x: number, sinTheta: number, p: Float64Array): void {
  const stride = MAX_ORDER + 1;
  p[0] = 1;
  // Sectoral: P_m^m = (2m-1)!! * sinTheta^m   (no (-1)^m)
  for (let m = 1; m <= order; m++) {
    p[m * stride + m] = p[(m - 1) * stride + (m - 1)]! * (2 * m - 1) * sinTheta;
  }
  for (let m = 0; m < order; m++) {
    p[(m + 1) * stride + m] = x * (2 * m + 1) * p[m * stride + m]!;
  }
  for (let m = 0; m <= order; m++) {
    for (let n = m + 2; n <= order; n++) {
      p[n * stride + m] =
        ((2 * n - 1) * x * p[(n - 1) * stride + m]! - (n + m - 1) * p[(n - 2) * stride + m]!) /
        (n - m);
    }
  }
}

const scratchP = new Float64Array((MAX_ORDER + 1) * (MAX_ORDER + 1));
const scratchCos = new Float64Array(MAX_ORDER + 1);
const scratchSin = new Float64Array(MAX_ORDER + 1);

/**
 * Evaluate the ACN/SN3D basis for a direction.
 * @param order ambisonic order
 * @param azimuth radians, positive counter-clockwise (left), 0 = front
 * @param elevation radians, positive up
 * @param out Float32Array of at least (order+1)^2 entries
 */
export function encodeDirection(
  order: number,
  azimuth: number,
  elevation: number,
  out: Float32Array,
): Float32Array {
  const sinEl = Math.sin(elevation);
  const cosEl = Math.cos(elevation);
  legendre(order, sinEl, cosEl, scratchP);

  const c = Math.cos(azimuth);
  const s = Math.sin(azimuth);
  scratchCos[0] = 1;
  scratchSin[0] = 0;
  for (let m = 1; m <= order; m++) {
    // Chebyshev recurrence for cos(m*phi) / sin(m*phi)
    scratchCos[m] = scratchCos[m - 1]! * c - scratchSin[m - 1]! * s;
    scratchSin[m] = scratchSin[m - 1]! * c + scratchCos[m - 1]! * s;
  }

  const stride = MAX_ORDER + 1;
  const total = channelCount(order);
  for (let k = 0; k < total; k++) {
    const n = acnDegree(k);
    const m = acnIndex(k);
    const am = m < 0 ? -m : m;
    const leg = scratchP[n * stride + am]!;
    const trig = m < 0 ? scratchSin[am]! : m > 0 ? scratchCos[am]! : 1;
    out[k] = NORM[k]! * leg * trig;
  }
  return out;
}

/** Convert ADM-normalized cartesian (X right, Y front, Z up) to polar. */
export function cartesianToPolar(x: number, y: number, z: number) {
  const r = Math.sqrt(x * x + y * y + z * z);
  const azimuth = Math.atan2(-x, y); // +azimuth = left
  const elevation = r > 1e-9 ? Math.asin(Math.max(-1, Math.min(1, z / r))) : 0;
  return { azimuth, elevation, distance: r };
}

/**
 * Dolby reference room proportion (length / width). The Dolby Atmos Renderer
 * stores an ear-level 45° side position as X = ±1, Y = 0.6805225.
 */
export const DOLBY_ROOM_ASPECT = 1 / 0.6805225015;

/**
 * Ear-level warp table: geometric perimeter angle (deg) -> Dolby speaker angle.
 *
 * At ear level the room box anchors to bed speaker zones:
 *   (±1, 1)      -> L/R          30°
 *   (±1, 0.6805) -> Lw/Rw        45°
 *   (±1, 0)      -> Lss/Rss      90°
 *   (±1, -1)     -> Lrs/Rrs     135°
 * At ceiling level the box anchors to the top rows, which sit at the plain
 * geometric angles (45° / 90° / 135°), so no warp is applied there.
 */
const EAR_GEO = [0, 45, 55.7638, 90, 135, 180];
const EAR_TARGET = [0, 30, 45, 90, 135, 180];

function warpEarAzimuth(absDeg: number): number {
  for (let i = 1; i < EAR_GEO.length; i++) {
    const g0 = EAR_GEO[i - 1]!;
    const g1 = EAR_GEO[i]!;
    if (absDeg <= g1) {
      const t = g1 - g0 < 1e-9 ? 0 : (absDeg - g0) / (g1 - g0);
      return EAR_TARGET[i - 1]! + t * (EAR_TARGET[i]! - EAR_TARGET[i - 1]!);
    }
  }
  return absDeg;
}

/**
 * Convert Dolby room-box cartesian coordinates to listening angles.
 *
 * Elevation is measured against the room perimeter (not the euclidean radius),
 * so the whole ceiling edge sits at 45°. Azimuth blends between the ear-level
 * speaker-zone warp and the plain ceiling geometry with height.
 */
export function roomCartesianToPolar(x: number, y: number, z: number) {
  const geoDeg = (Math.atan2(-x, y) * 180) / Math.PI;
  const sign = geoDeg < 0 ? -1 : 1;
  const absGeo = Math.abs(geoDeg);
  const h = Math.min(1, Math.abs(z));
  const azDeg = sign * ((1 - h) * warpEarAzimuth(absGeo) + h * absGeo);
  const azimuth = (azDeg * Math.PI) / 180;

  const horizontal = Math.max(Math.abs(x), Math.abs(y));
  const elevation =
    horizontal > 1e-9 ? Math.atan2(z, horizontal) : z >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const distance = Math.min(1, Math.sqrt(x * x + y * y + z * z)) || 1;
  return { azimuth, elevation, distance };
}



export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

/** Analytic self-test of the first-order identities + CS-phase omission. */
export function verifyBasis(): { name: string; ok: boolean; detail: string }[] {
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const buf = new Float32Array(channelCount(7));
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  const cases: { az: number; el: number }[] = [
    { az: 0, el: 0 },
    { az: deg2rad(30), el: 0 },
    { az: deg2rad(-135), el: 0 },
    { az: deg2rad(90), el: deg2rad(45) },
    { az: deg2rad(17), el: deg2rad(-62) },
  ];

  let foaOk = true;
  let foaDetail = "";
  for (const { az, el } of cases) {
    encodeDirection(7, az, el, buf);
    const expect = [1, Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    for (let k = 0; k < 4; k++) {
      if (!near(buf[k]!, expect[k]!)) {
        foaOk = false;
        foaDetail = `ACN ${k} at az=${rad2deg(az).toFixed(0)}° el=${rad2deg(el).toFixed(0)}°: ${buf[k]!.toFixed(6)} vs ${expect[k]!.toFixed(6)}`;
      }
    }
  }
  results.push({
    name: "First-order identity (W, Y, Z, X)",
    ok: foaOk,
    detail: foaOk ? "exact match on 5 directions" : foaDetail,
  });

  // Condon-Shortley omission: Y_1^1 at front must be +1, not -1.
  encodeDirection(3, 0, 0, buf);
  results.push({
    name: "Condon-Shortley phase omitted",
    ok: near(buf[3]!, 1),
    detail: `ACN 3 at front = ${buf[3]!.toFixed(6)} (must be +1)`,
  });

  // Second order sectoral check: Y_2^2 = sqrt(3)/2 * cos^2(el) * cos(2az)
  const az = deg2rad(40);
  const el = deg2rad(20);
  encodeDirection(3, az, el, buf);
  const expect22 = (Math.sqrt(3) / 2) * Math.cos(el) ** 2 * Math.cos(2 * az);
  results.push({
    name: "Second-order sectoral (ACN 8)",
    ok: near(buf[8]!, expect22),
    detail: `${buf[8]!.toFixed(6)} vs ${expect22.toFixed(6)}`,
  });

  // Zonal at the pole: Y_n^0(90°) = 1 for all n under SN3D.
  encodeDirection(7, 0, Math.PI / 2, buf);
  let zonalOk = true;
  for (let n = 0; n <= 7; n++) if (!near(buf[n * (n + 1)]!, 1)) zonalOk = false;
  results.push({
    name: "Zonal harmonics at zenith = 1 (SN3D)",
    ok: zonalOk,
    detail: "orders 0..7",
  });

  return results;
}
