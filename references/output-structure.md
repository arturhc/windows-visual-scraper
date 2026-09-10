# Output structure

Existing source/session folders remain valid and retain their manifests, traces, screenshots, and media. Twin analysis files are stored beside their media so paths remain portable.

```text
<collection>/
├── REPORT.md                         legacy-compatible visual gallery
├── content-manifest.json             unified machine-readable inventory
├── <platform>-<source>/<attempt>/
│   ├── manifest.json
│   ├── run.ndjson
│   └── media/
│       ├── descriptive-image.png
│       └── descriptive-image.md
├── assets/videos/
│   └── descriptive-video/
│       ├── original.mp4
│       ├── metadata.json
│       ├── video.md
│       ├── audio.wav                 when enabled and present
│       └── scenes/
│           └── scene-001/
│               ├── keyframe-001.jpg
│               └── keyframe-001.md
└── reports/
    ├── images-index.md
    ├── videos-index.md
    └── run-report.md
```

`content-manifest.json` explicitly relates asset, description, source, type, parent, scene, timestamp, paths, status, hashes, duplicates, and errors. Consumers must use it instead of guessing relationships from filenames.

`index --root COLLECTION` rebuilds all three indexes and the unified manifest. Legacy `report` also performs this rebuild automatically.
