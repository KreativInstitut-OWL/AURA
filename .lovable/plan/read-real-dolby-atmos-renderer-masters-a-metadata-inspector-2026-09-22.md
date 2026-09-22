# Read real Dolby Atmos Renderer masters (+ a metadata inspector)

## What happened

Your file's metadata is there — the app just doesn't follow the path to it.

Every track in an ADM file points at a description of "where this sound is".
There are two ways a file can express that link:

1. A direct shortcut (newer, simpler) — the only one the app currently reads.
2. A chain of three hops (track format -> stream format -> channel format) — the
   classic form that the Dolby Atmos Renderer writes.

Your master uses the chain, so each track lookup comes up empty and every track
gets skipped. Separately, bed channels (L, R, C, LFE...) in these files usually
reference the ITU "common definitions" catalogue by ID instead of spelling the
definition out in the file — the app has no copy of that catalogue, so those
would still resolve to nothing even after the chain is followed.

Both are fixable, and neither means anything is wrong with your file.

## The fix

1. Follow the full chain when the shortcut is absent, and fall back to the
   routing table already embedded in the file's track list if the chain is
   incomplete.
2. Build in the standard speaker catalogue.

   For the 7.1.2 bed, ADM files don't write out "this channel is the left
   surround speaker, at 100 degrees to the side, level with your ears". Those
   definitions are standardised once by the ITU, and the file just cites them by
   catalogue number — the same way a recipe says "flour, type 550" instead of
   describing the flour. The Dolby Atmos Renderer writes those citations, so if
   the app doesn't carry the catalogue, the bed channels stay nameless even
   after step 1 fixes the lookup path.

   So: embed that catalogue (L, R, C, LFE, Lss, Rss, Lrs, Rrs, the two height
   channels and the common variants) and match each bed track to its entry.

   An unknown catalogue number is always reported, never silently guessed: the
   track is listed by name and number in a prominent warning and marked
   unresolved in the inspector. A fallback guess from the layout name may be
   offered so the render can still proceed, but only alongside that warning and
   clearly labelled as a guess.
3. Accept the vendor-namespaced and prefixed tag spellings these files use, so
   positions and timing parse regardless of how the XML is namespaced.
4. Report per-track *why* a resolution failed instead of one flat "no channel
   format" line.

## Debug inspector

A new collapsible "Metadata inspector" panel below the stream map, with:

- Resolution trace per track: UID -> track format -> stream format -> channel
  format -> speaker/object, showing exactly which hop broke.
- Counts at a glance: tracks, resolved beds, resolved objects, unresolved.
- Chunk map: every chunk found, its size and offset, plus which were used.
- Raw axml viewer with search, element-name frequency list, and a copy button.
- "Copy diagnostics" button producing a shareable text report (no audio data).

## Technical notes

- `src/engine/adm.ts`: build `audioTrackFormatID -> audioStreamFormatID ->
  audioChannelFormatID` indexes (matching both `audioStreamFormat`'s
  `audioTrackFormatIDRef` children and `audioTrackFormat`'s own stream ref);
  resolve `chna.trackRef`/`packRef` as the fallback when the axml chain is
  broken. Add a `COMMON_DEFINITIONS` map for `AC_0001xxxx` channel IDs and
  `AP_0001xxxx` pack IDs. Make element lookups local-name based throughout.
  Return a structured `TrackDiagnostic[]` alongside `sources`/`warnings`.
- `src/engine/types.ts`: add the diagnostic types.
- `src/components/adm/MetadataInspector.tsx`: new panel component.
- `src/routes/index.tsx`: render the inspector; group warnings instead of
  listing one line per track.

No changes to the rendering math, worker, or output writer.
