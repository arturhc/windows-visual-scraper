# Creative Content Intelligence for Windows

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This Codex skill turns authorized website, Facebook, and Instagram references into a structured creative knowledge base. It preserves the existing visible Microsoft Edge image workflow and adds mandatory image analysis twins, optional video processing, intelligent scene/keyframe extraction, provenance, resumability, and unified reports.

The package name remains `windows-visual-image-scraper` for compatibility with existing `$windows-visual-image-scraper` prompts and installations.

## What it produces

Every retained image has a same-basename Markdown representation:

```text
producto-sobre-mesa.png
producto-sobre-mesa.md
```

Video output preserves the original and its hierarchy:

```text
assets/videos/demostracion-producto/
├── original.mp4
├── metadata.json
├── video.md
├── audio.wav
└── scenes/
    └── scene-001/
        ├── keyframe-001.jpg
        └── keyframe-001.md
```

The collection also contains:

- `content-manifest.json`: machine-readable inventory and relationships;
- `reports/images-index.md`: images/keyframes and twin analyses;
- `reports/videos-index.md`: original videos, metadata, scenes, and analyses;
- `reports/run-report.md`: coverage, errors, duplicates, and totals;
- `REPORT.md`: the existing compatible visual gallery and WhatsApp shortlist.

See [output structure](references/output-structure.md), [image contract](references/image-analysis-contract.md), [video contract](references/video-analysis-contract.md), and [architecture](references/architecture.md).

## Defaults

- Images: enabled.
- Video: disabled until explicitly requested.
- Maximum videos per source: 10, configurable.
- Scene detection: hard cuts plus softer meaningful visual changes.
- Keyframe deduplication: SHA-256 plus structural dHash and mean-color distance.
- Audio extraction: enabled when video has audio.
- Transcription: optional; absence never blocks the rest of the pipeline.

Create and validate a centralized config:

```powershell
node scripts/image-scraper.mjs init-config --output ".\content-config.json"
node scripts/image-scraper.mjs validate-config --config ".\content-config.json"
```

## Requirements

Image collection:

- Windows 10 or Windows 11 with an interactive unlocked desktop;
- Microsoft Edge;
- Node.js 20 or newer;
- PowerShell 5.1 or newer;
- Codex or another image-capable host agent.

Video processing additionally requires `ffmpeg` and `ffprobe`. The Windows essentials build is sufficient. Install through an available package manager or download a Windows build linked by the [official FFmpeg download page](https://ffmpeg.org/download.html). The CLI never assumes they exist:

```powershell
node scripts/image-scraper.mjs doctor-video
node scripts/image-scraper.mjs doctor-video --ffmpeg-path "C:\tools\ffmpeg\bin\ffmpeg.exe" --ffprobe-path "C:\tools\ffmpeg\bin\ffprobe.exe"
```

Whisper CLI is optional and used only when transcription is explicitly enabled.

## Install as a Codex skill

```powershell
$skillDirectory = Join-Path $env:USERPROFILE ".agents\skills\windows-visual-image-scraper"
git clone https://github.com/arturhc/windows-visual-scraper.git $skillDirectory
npm ci --prefix $skillDirectory
node "$skillDirectory\scripts\image-scraper.mjs" doctor
```

## Image workflow

The host agent continues to resolve targets, inspect every screenshot, navigate the visible UI, reject unsuitable frames, crop, name, and analyze accepted images. The scripts remain deterministic and make no AI API calls.

```powershell
node scripts/image-scraper.mjs start `
  --preset instagram-photo-posts `
  --url "https://www.instagram.com/example/" `
  --count 8 `
  --output ".\collections" `
  --collection "brand-references" `
  --target-label "example" `
  --platform instagram `
  --report-language es `
  --confirm-live-ui
```

When saving, provide the deep analysis JSON whenever ready:

```powershell
node scripts/image-scraper.mjs save `
  --session "C:\path\session.json" `
  --input "C:\path\frame.png" `
  --crop-box "0.05,0.08,0.74,0.95" `
  --name "producto-siendo-utilizado-en-cocina" `
  --description "Una persona utiliza el producto sobre una encimera clara." `
  --whatsapp-rating 5 `
  --whatsapp-reason "La acción y el producto se entienden en tamaño pequeño." `
  --analysis-file ".\image-analysis.json"
```

Without `--analysis-file`, a structurally complete `basic` twin is created immediately. It is intentionally not counted as deep analysis.

## Video workflow

`import-video` accepts an authorized local file or a direct accessible media URL. It does not export browser cookies, copy Edge profiles, bypass DRM, or break access controls.

```powershell
node scripts/image-scraper.mjs import-video `
  --root ".\collections\brand-references" `
  --input ".\authorized-reel.mp4" `
  --source-page "https://www.instagram.com/example/" `
  --platform instagram `
  --source-account "example" `
  --name "demostracion-producto-en-cocina" `
  --config ".\content-config.json"
```

The cheap deterministic pass probes media, detects scene/visual boundaries, removes redundant candidates, extracts representative frames, and creates baseline twins. The host then inspects the compact evidence set and supplies the multimodal synthesis:

```powershell
node scripts/image-scraper.mjs analyze-video `
  --root ".\collections\brand-references" `
  --video-root ".\collections\brand-references\assets\videos\demostracion-producto-en-cocina" `
  --analysis-file ".\video-analysis.json"
```

See the templates in [assets/templates](assets/templates).

## Backfill and reporting

Upgrade assets created by older versions without scraping again:

```powershell
node scripts/image-scraper.mjs backfill --root ".\collections\brand-references"
```

Rebuild all inventories:

```powershell
node scripts/image-scraper.mjs report --root ".\collections\brand-references" --language es --max-recommendations 5
node scripts/image-scraper.mjs index --root ".\collections\brand-references"
```

Backfill and video import are idempotent: existing twins are skipped, duplicate images are rejected collection-wide, and completed videos are resumed by content hash.

## Safety

- Visible UI automation is bounded to the Edge window created for a session.
- Authentication remains manual; passwords, cookies, and browser profiles are not copied.
- Stop on CAPTCHA, checkpoint, account-security prompt, consent change, rate limit, or ambiguous target.
- Do not download inaccessible content or circumvent DRM.
- Creative recipes extract principles; they must not request literal reproduction of people, logos, brands, or incidental details.

## Development

```powershell
npm ci
npm run check
npm run validate:workflows
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs doctor-video
```

The video integration test runs when FFmpeg/FFprobe are on PATH or when `FFMPEG_PATH` and `FFPROBE_PATH` point to executables.

See [CLI reference](references/cli.md) and [implementation report](IMPLEMENTATION_REPORT.md).

## License

MIT. See [LICENSE](LICENSE).
