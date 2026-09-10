---
name: windows-visual-image-scraper
description: Build a structured creative-reference knowledge base from visible website, Facebook, and Instagram images, plus optional authorized videos, on Windows. Use for brand content intelligence, creative reference mining, semantic media collection, image/video analysis, scene/keyframe extraction, backfill, provenance, and consolidated reports. Do not use to bypass access controls, export browser credentials, defeat DRM, or copy a reference literally.
metadata:
  short-description: Creative content intelligence on Windows
---

# Creative Content Intelligence

Own the job from source resolution through the final reusable knowledge base. Preserve the existing visible Microsoft Edge image-acquisition workflow, but treat every retained media file as both an asset and a structured creative reference:

```text
media -> analysis -> reusable reference -> manifest -> reports
```

The compatibility identifier remains `windows-visual-image-scraper`; do not rename the folder or invocation without a migration. Read [architecture.md](references/architecture.md) when modifying the system and [output-structure.md](references/output-structure.md) when validating deliverables.

## Configure the job

Determine website, Facebook, Instagram, and other relevant sources. Do not ask again for URLs the user already supplied. When sources are missing, ask only for the missing information or offer to research official accounts. Never silently select among materially ambiguous brands.

Images are enabled by default. If media scope was not specified, ask whether the user wants images only or images plus video. Video is opt-in and defaults to at most 10 videos per source. A fully specified request or config must run non-interactively. Read [configuration.md](references/configuration.md) when creating or consuming a job config.

## Acquire images

Before live UI work, read [cli.md](references/cli.md) and [deliverables.md](references/deliverables.md).

1. Run `doctor --capture-test --confirm-live-ui`, then dry-run each browser source.
2. Use the existing `facebook-photos`, `instagram-photo-posts`, or `generic-lightbox-gallery` workflow. Use `import-image` for a principal image on a non-gallery page.
3. Inspect every returned PNG. Execute one bounded action at a time and accept only clear still media. Reject videos, interfaces, grids, loading states, ambiguity, irrelevant content, and duplicates.
4. Crop tightly and save with a semantic visible-content name. Preserve the original extension for direct imports; use stable numeric suffixes only to resolve a real collision.
5. Supply `--analysis-file` during `save`/`import-image` whenever the visual analysis is ready. The CLI always creates a twin Markdown file; without deep input it is marked `basic` and must later be upgraded with `analyze-image`.
6. Finish every browser session in cleanup even after failure.

For each image, read [image-analysis-contract.md](references/image-analysis-contract.md). Analyze visible content, purpose, intent, composition, lighting, apparent camera treatment, art direction, graphics, color, effectiveness, reusable principles, nonessential details, conceptual recreation, and original-generation prompts. Separate observed, inferred, and unknown facts. Never invent identities, equipment, focal lengths, fonts, LUTs, or software.

## Acquire and process video

Read [video-analysis-contract.md](references/video-analysis-contract.md). Run `doctor-video` before enabling video. FFmpeg and FFprobe are required; Whisper is optional.

Use visible Edge navigation to identify candidate video pages and source adapters to normalize their platform/provenance while keeping acquisition separate from analysis. `import-video` accepts an authorized local file or a direct accessible HTTP(S) media URL. Do not export Edge cookies, copy browser profiles, retain secrets, derive hidden expiring URLs, bypass DRM, or defeat platform controls. If the original cannot be obtained within those boundaries, record a partial error and continue other assets.

The video pipeline must:

- enforce configurable `maxVideosPerSource` (default 10);
- enforce a configurable input/download size ceiling (default 1 GiB);
- preserve and hash the original;
- probe duration, resolution, FPS, codecs, and audio;
- select the opening frame, hard scene changes, and softer meaningful changes after a configurable gap;
- deduplicate candidates using SHA-256 plus structural and mean-color fingerprints;
- create ordered scene directories, representative keyframes, and twin Markdown files;
- extract audio when enabled and degrade gracefully when transcription is unavailable;
- write `metadata.json` and `video.md` with explicit parent/scene/frame relationships;
- resume by content hash instead of reprocessing a completed video.

After inspecting the representative frames and available audio/transcript, use `analyze-video --analysis-file` to create the deep multimodal synthesis. The result must let another agent reconstruct what happens, in what order, how it communicates, what is essential, and how to reinterpret the creative logic without copying the reference.

## Backfill and resume

Run `backfill --root COLLECTION` on legacy collections. It scans source manifests, creates missing image twins, adds dimensions and analysis state, and rebuilds indexes without scraping again. It skips existing analyzed assets unless `--force` is explicitly used. Deepen `basic` assets with `analyze-image` or `analyze-video`.

Exact hashes prevent duplicate storage across the collection. Video imports resume by hash. Preserve partial manifests, errors, valid media, and completed analysis across reruns.

## Complete the knowledge base

Run `report --root COLLECTION` for the legacy visual gallery and `index --root COLLECTION` for the unified inventory. Verify:

- every retained image/keyframe has a same-basename `.md`;
- `content-manifest.json` contains source, type, paths, hashes, analysis state, parents, scenes, timestamps, duplicates, and structured errors;
- `reports/images-index.md`, `videos-index.md`, and `run-report.md` link to real files;
- coverage distinguishes `basic` from `analyzed` rather than overstating completion;
- errors contain asset, stage, source, retryability, and cause;
- generation guidance extracts abstract creative principles and never requests literal copying.

Do not stop after downloading. Continue through organization, analysis, manifests, and reporting for every enabled media type.

## Safety and quality boundaries

- Warn once that live Windows UI work takes focus and may move the pointer.
- Stop for CAPTCHA, checkpoints, account-security prompts, consent changes, rate limits, destructive controls, or ambiguous identity.
- Collect only content the user is authorized to access and retain.
- Close only the Edge window created by the session unless `--keep-open` was requested.
- Prefer respectful, non-sensitive reference material. Ratings and creative analysis are not permission to republish.
- Analyze deeply only after cheap metadata, scene selection, and redundancy filtering. Do not send or inspect hundreds of equivalent frames.
