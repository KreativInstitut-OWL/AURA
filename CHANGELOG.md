# Changelog

All notable changes to AURA. Dates are UTC. Versions are grouped by milestone.

## [0.9.0] — 2026-11-17 – 2026-11-18 (current release)

### Added
- NGA multi-programme selection: all `audioProgramme`s are resolved to their tracks; a picker in the Track & Source Inspector selects one version; other versions are muted in render, viewer, meters and peak estimate. Single-programme files are unchanged.
- Programme name in the export filename, only for files with more than one programme.
- Time-multiplexed objects: `audioObject` start/duration now bounds when an object is audible; the inspector shows the active time range.
- File picker accepts `.wave` and `.bw64`; save dialog offers `.wave`, `.bw64`, `.rf64`.
- Live deployment link (`https://aura.kreativ.institute`) in the README.

### Fixed
- Peak estimate showed −∞ dBFS after switching programmes.
- Empty peak-scan window lists no longer trigger a zero-length scan.

### Changed
- Package metadata aligned (`aura-renderer` 0.9.0).
- Roadmap refreshed: binaural headphone audition is the open milestone.
- Build tooling dependency updated.

## [0.8.0] — 2026-11-12

### Added
- ITU mode shows its own bed reference table (ITU-R BS.2051, System G 13.1 with omni LFE); Dolby mode keeps the 7.1.2 table.
- Binaural headphone feeds (`AC_0005xxxx`) are recognised and marked "skipped".
- Clear diagnostic for encoded data streams such as Dolby E.

### Fixed
- Inspector showed identical coordinates for objects sharing one physical track (rows now keyed by track UID).

## [0.7.0] — 2026-11-09 – 2026-11-10

### Added
- Renders over 1 GiB show a manual save button instead of auto-downloading (prevents Safari crashes).
- Disk-backed rendering via private browser storage when direct file writing is unavailable.
- Build timestamp in the footer.

### Changed
- LFE default gain 0 dB, with automatic level switch per route; "−3 dB" labelled as constant power.

### Fixed
- Output meters are cleared after a finished render.
- Auto-download and related UI issues.

## [0.6.0] — 2026-11-04 – 2026-11-05

### Added
- Peak pre-scan with ~500 ms estimate, per-order tiers and gain recommendation.
- Drag-and-drop loading and expandable inspector detail rows.
- KreativInstitut.OWL logos bundled in the repository.

### Fixed
- Peak timing drift and envelope alignment; peaks reset on cancel.

## [0.5.0] — 2026-11-03

### Added
- MIT license, project README and self-hosting (Coolify/Railpack) support.
- UI and visualiser polish: mode info popover, higher sphere contrast, rotation control, level-display toggle, combined Type column in the inspector.
- Footer with legal links and trademark disclaimer.
- Clipping pause: cancel or continue with acknowledged clipping.

## [0.4.0] — 2026-09-30 – 2026-10-03

### Added
- Four LFE routes (Omni, Lower hemisphere, Position, Off) with separate gain and 120 Hz Butterworth filter.
- 24-bit flat TPDF dither.
- ITU bed loudspeaker test files.

### Changed
- Dolby side surrounds aligned to 100°.

## [0.3.0] — 2026-09-28 – 2026-09-29

### Added
- ITU mode and German UI.
- AURA name and branding; peak readout next to render duration; gain tag in filename.

### Removed
- Binaural audition from the UI (engine kept for a future version).

## [0.2.0] — 2026-09-23

### Added
- Experimental HOAST binaural preview engine.

## [0.1.0] — 2026-09-22

### Added
- Initial browser-based ADM-to-Ambisonics renderer: RIFF/RF64 parsing, `axml`/`chna` analysis, direct ACN/SN3D encoding in Web Workers, 3D viewer, meters and export.
- Metadata inspector; explicit coordinates take priority over nominal angles.
