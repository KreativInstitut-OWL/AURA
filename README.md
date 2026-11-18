# AURA — ADM Universal Renderer into Ambisonics

> **Immersive audio engineers get their Atmos and ADM mixes as faithful Ambisonics masters.**

**Try it live:** [aura.kreativ.institute](https://aura.kreativ.institute)

AURA is a free, open-source workstation that runs entirely in your web browser. It reads ADM broadcast-wave masters (ITU-R BS.2076) — including Dolby Atmos ADM BWF exports — and renders them directly into Higher-Order Ambisonics (AmbiX: ACN channel order, SN3D normalisation) at 3rd, 5th or 7th order.

Your audio never leaves your computer: there is no upload, no server-side processing and no tracking.

---

## Why AURA?

The usual route from an object-based mix to Ambisonics renders to a virtual loudspeaker layout (e.g. 7.1.4) and then re-encodes those speakers into Ambisonics. That detour adds phantom-source blur and comb filtering.

AURA skips the loudspeaker stage. Every bed channel and every moving object is encoded straight from its own position into spherical-harmonic coefficients, block by block, with smooth coefficient ramps between metadata keyframes.

## Features

- **Direct HOA encoding** — 3OA (16 ch), 5OA (36 ch) or 7OA (64 ch); ACN / SN3D without Condon–Shortley phase.
- **Two spatial interpretations**
  - **Dolby mode** — places beds and objects using Dolby room coordinates (continuous room warp, 7.1.2 bed).
  - **ITU mode** — pure geometry and spherical projection per ITU-R BS.2076 / BS.2051.
  - Explicit coordinates in the file always take precedence over nominal speaker angles.
- **Multi-programme (NGA) files** — files with several `audioProgramme`s (e.g. language versions) get a programme picker; other versions are muted and the programme name is added to the export filename. Single-programme files are unaffected.
- **Time-multiplexed objects** — objects sharing one physical track are only audible inside their own `start`/`duration` window.
- **LFE handling** — 120 Hz 4th-order Butterworth low-pass; routes *Omni*, *Lower hemisphere*, *Position* or *Off*; separate gain (−3 / 0 / +10 dB).
- **Peak estimate and clipping safety** — fast pre-scan suggests a safe master gain; rendering pauses on clipping so you can cancel or continue. No hidden limiter.
- **3D trajectory viewer** — bed anchors, animated object paths and level-driven markers.
- **Track & Source Inspector** — shows how each track was resolved (bed, object, skipped, unresolved) plus a copyable diagnostics report.
- **Channel mapping for plain multichannel WAVs** — assumed default order per channel count, fully editable.
- **Large files** — streams multi-gigabyte RF64/BW64 masters in small blocks and writes output straight to disk where the browser allows it.
- **English and German UI**, light and dark theme.

## Supported formats

| | |
|---|---|
| **Input containers** | RIFF/BWF, RF64, BW64 (`.wav`, `.wave`, `.bwf`, `.bw64`) |
| **Input samples** | 16/24/32-bit integer PCM, 32-bit IEEE float |
| **Metadata** | `axml` + `chna` (ITU-R BS.2076 / BS.2094 common definitions) |
| **Output** | AmbiX WAV / RF64, `WAVE_FORMAT_EXTENSIBLE`, 24-bit with TPDF dither |
| **Sample rate** | Always identical to the input (48 or 96 kHz) — never resampled |

Encoded data streams (e.g. Dolby E) and binaural headphone feeds are detected and skipped.

## Export filename

```
<name>[_<Programme>][_ITU][_<gain>]_AmbiX_<3|5|7>OA[_<LFE route/gain>]_AURA.wav
```

Optional parts only appear when they apply.

## Browser support

Current Chrome, Edge, Firefox and Safari. Chromium-based browsers can write directly to a chosen file; other browsers stage the result in private browser storage before download.

## Running locally

Requires [Bun](https://bun.sh) (or Node.js 20+ with npm).

```sh
git clone <this-repository-url>
cd <repository-folder>
bun install
bun run dev        # http://localhost:8080
bunx vitest run    # test suite
```

### Self-hosting (Node server)

```sh
bun install --frozen-lockfile
bun run build:coolify
PORT=3000 HOST=0.0.0.0 bun run start
```

For Coolify/Railpack: use server mode (not static site), port 3000, and leave build/start overrides empty — `railpack.json` already selects the right commands.

## Project structure

```
src/engine/   container parsing, ADM analysis, spherical harmonics, render workers
src/components/adm/   viewer, meters, inspector, channel mapping
src/routes/index.tsx  the workstation UI
```

## Known limitations

- ADM distance is not used (sources are encoded as plane waves).
- Screen-relative (MPEG-H style) metadata is not applied.
- Channel order of plain WAV files without ADM metadata is ambiguous — check the mapping.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Credits & license

Created by [**Sascha Armin Etezazi**](https://kreativ.institute/de/ueber-kio/team/sascha-etezazi), [KreativInstitut.OWL](https://kreativ.institute) (Komposition & Sounddesign).

Released under the [MIT License](./LICENSE).

AURA is an independent tool. It is not affiliated with, sponsored by or endorsed by Dolby Laboratories. "Dolby" and "Dolby Atmos" are trademarks of Dolby Laboratories and are mentioned only to describe file compatibility.
