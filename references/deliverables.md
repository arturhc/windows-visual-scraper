# Collection deliverables

Use one shared collection root for every source in a job. The output is both a browsable folder and a machine-readable content-intelligence dataset.

## Required structure

```text
<collection>/
├── REPORT.md
├── content-manifest.json
├── content-errors.ndjson                 # only when early failures occur
├── reports/
│   ├── images-index.md
│   ├── videos-index.md
│   └── run-report.md
├── assets/
│   └── videos/
│       └── <semantic-video-name>/
│           ├── original.<ext>
│           ├── metadata.json
│           ├── video.md
│           ├── audio.wav                 # when enabled and present
│           ├── transcript.*              # when requested and available
│           └── scenes/
│               └── scene-001/
│                   ├── keyframe-001.jpg
│                   └── keyframe-001.md
└── <platform>-<target>/
    └── <timestamp>/
        ├── session.json                  # browser sessions only
        ├── manifest.json
        ├── run.ndjson
        ├── media/
        │   ├── 001-semantic-name.png
        │   └── 001-semantic-name.md
        ├── screenshots/
        ├── raw/
        └── trace/
```

Direct still-image imports use the platform/target/timestamp layout without a browser session. Every curated image and every retained video keyframe must have a same-basename Markdown twin. Raw screenshots and evidence-only viewport captures do not count as curated image assets.

## Descriptive naming

Name assets from the dominant visible subject, action, setting, and distinctive treatment. Prefer names such as `equipo-posando-en-recepcion`, `producto-azul-sobre-pedestal`, or `demostracion-de-serum-en-estudio`. Reject generic names such as `image-001`, `photo`, or `capture`.

Do not infer identities, relationships, locations, dates, emotions, sensitive traits, or claims that are not visually supported. Stable numeric prefixes and collision suffixes are added by the tooling.

## Image knowledge asset

The Markdown twin should expose provenance and technical metadata, then separate observation from inference and unknowns. A deep image analysis covers exhaustive visual description, communication objective, composition, hierarchy, lighting, camera, art direction, styling, typography, color, reusable versus arbitrary choices, improvement opportunities, recreation recipe, generation prompt, negative prompt, and safe variations.

If deep semantic inspection has not happened yet, keep the automatically generated baseline and mark it `basic`; never present guessed detail as analyzed fact.

## Video knowledge asset

Preserve the original video. `metadata.json` is authoritative for duration, resolution, fps, codecs, audio presence, hashes, scene boundaries, keyframe relationships, tool versions, errors, and processing status. `video.md` contains the semantic analysis.

The hierarchy is explicit: video → scenes → keyframes. Scene boundaries come from hard cuts plus spaced meaningful visual changes. Perceptual and color-aware deduplication removes redundant frames while keeping structurally similar frames whose visual content differs materially.

Deep analysis covers hook, narrative arc, scene timeline, shot type, camera movement, lens/perspective, lighting, art direction, editing rhythm and transitions, color progression, onscreen text, audio/transcript, communication function, essential versus arbitrary choices, recreation plan, shot list, generation prompt, and variants.

## WhatsApp editorial shortlist

Favor clear subjects, readable moments at phone-preview size, useful emotion or discussion value, strong crops, and absence of interface clutter or private data. Penalize duplicates, tiny subjects, ambiguity, low resolution, sensitive content, and accidental frames. The requested top N is an exact cap; an explicit `recommended: false` is always respected.

## Final verification

1. Confirm every curated image and retained keyframe has its Markdown twin.
2. Confirm originals, analyses, manifests, and report links exist.
3. Compare logical source totals with source manifests; retries remain auditable without inflating source counts.
4. Confirm SHA-256 duplicate suppression and visual keyframe deduplication behaved as expected.
5. Confirm `content-manifest.json` relationships resolve from video to scene to keyframe.
6. Confirm partial failures appear in video metadata or `content-errors.ndjson` and in the run report.
7. Confirm analysis coverage distinguishes `basic` from `analyzed` assets.
8. Confirm no credentials, cookies, profile data, browser UI, or access-control workarounds were collected.
