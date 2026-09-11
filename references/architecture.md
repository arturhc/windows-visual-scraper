# Architecture

The skill keeps the existing Edge-based visual acquisition protocol and adds a platform-neutral content-intelligence layer. Acquisition and understanding are deliberately separate.

Media-scope routing gates the two acquisition pipelines before any media-specific diagnostics, discovery, reference loading, or analysis. The supported modes are `images-only`, `videos-only`, and `images-and-videos`; `images-only` is the default. Disabled pipelines must not consume tools or analysis context, while both pipelines continue to share the manifest and report layer when enabled together.

```text
source resolution
  -> source adapter
  -> visual capture or direct/local import
  -> normalization and semantic naming
  -> exact collection deduplication
  -> twin Markdown analysis
  -> content-manifest.json
  -> reports/*.md

video import or visible Windows recording
  -> authorized local/direct media OR FFmpeg gdigrab player-region capture
  -> FFprobe metadata
  -> FFmpeg hard-cut + meaningful-change selection
  -> structural/color perceptual deduplication
  -> scene/keyframe hierarchy
  -> optional audio/transcription
  -> video and keyframe analysis
  -> shared manifest/report layer
```

## Components

- `agent-session.mjs`, workflows, and Windows helpers: existing visible Edge image acquisition.
- `direct-import.mjs`: direct still-image acquisition for non-gallery pages.
- `source-adapters.mjs`: source capability registry for website, Instagram, Facebook, and future providers.
- `content-config.mjs`: normalized versioned configuration; images on and video off by default.
- `analysis-contract.mjs`: stable image, keyframe, and video Markdown contracts with observed/inferred/unknown separation.
- `knowledge-assets.mjs`: mandatory image-to-twin-Markdown conversion.
- `backfill.mjs`: idempotent generation of missing twins and later deep-analysis replacement.
- `media-tools.mjs`: FFmpeg/FFprobe diagnostics, probing, scene candidates, audio extraction, and perceptual fingerprints.
- `screen-recorder.mjs`: bounded Windows `gdigrab` recording of an explicitly selected visible player region, with optional authorized DirectShow audio input.
- `video-pipeline.mjs`: resumable video import, source limits, scene hierarchy, keyframes, and analysis documents.
- `content-manifest.mjs`: one machine-readable inventory and human indexes across legacy and new assets.
- `report.mjs`: legacy-compatible gallery report plus automatic content-intelligence report regeneration.

## Scene selection

FFmpeg evaluates every decoded frame with its native `scene` score. The selection expression keeps:

1. the first frame;
2. hard changes above `hardThreshold`;
3. softer but meaningful changes above `softThreshold` after `meaningfulChangeGapSeconds`.

This is intentionally not fixed-interval extraction. The soft branch represents important changes inside longer takes without retaining continuous talking-head redundancy. Selected candidates are reduced again using exact SHA-256, grayscale structural dHash, and mean-color distance. Structural similarity alone cannot collapse a meaningful color or lighting change.

Each selected visual boundary begins an ordered scene/visual segment. The next boundary supplies its end time; the final segment ends at the probed video duration.

## Compatibility decision

The installed skill name remains `windows-visual-image-scraper`. Renaming it would break explicit `$windows-visual-image-scraper` prompts, installation paths, and existing automation. The user-facing product description now says Content Intelligence, while the old name remains a compatibility identifier. A future major release may introduce an alias before renaming.
