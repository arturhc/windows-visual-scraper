# CLI reference

Run commands from the skill directory or invoke `scripts/image-scraper.mjs` by absolute path. Relative paths resolve from the caller's directory. The CLI performs deterministic acquisition, storage, media processing, and report generation; Codex supplies the editorial and deep-analysis judgments.

## Configuration and diagnostics

```powershell
node scripts/image-scraper.mjs init-config --output ".\content-config.json"
node scripts/image-scraper.mjs validate-config --config ".\content-config.json"
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs doctor --capture-test --confirm-live-ui
node scripts/image-scraper.mjs doctor-video --ffmpeg-path "C:\tools\ffmpeg.exe" --ffprobe-path "C:\tools\ffprobe.exe"
node scripts/image-scraper.mjs list-source-adapters
node scripts/image-scraper.mjs list-presets
node scripts/image-scraper.mjs validate-workflow --all
```

Images are enabled by default. Video processing is opt-in through `media.videos`, `video.enabled`, or the `import-video` command. FFmpeg and FFprobe are optional for image-only runs; Whisper is optional even for video and is only required when transcription is requested.

## Browser acquisition session

```powershell
node scripts/image-scraper.mjs start `
  --preset instagram-photo-posts `
  --url "https://www.instagram.com/example/" `
  --count 5 `
  --output ".\social-collections" `
  --collection "campaign-references" `
  --target-label "example" `
  --platform instagram `
  --report-language es `
  --max-recommendations 5 `
  --confirm-live-ui
```

Use exactly one of `--preset NAME` or `--workflow PATH`. `run` is an alias for `start`. The result includes `collectionRoot`, `sessionPath`, `screenshotPath`, and the active workflow stage. Important options include `--pause-for-login`, `--profile NAME`, `--launch-wait-ms N`, `--wait-ms N`, `--no-fullscreen`, `--keep-open`, `--dry-run`, and the required live-action acknowledgement `--confirm-live-ui`.

Observe and perform one validated action at a time:

```powershell
node scripts/image-scraper.mjs shot --session "C:\path\session.json" --context open-first-post --label after-login
node scripts/image-scraper.mjs act --session "C:\path\session.json" --context open-first-post --click "0.20,0.74"
node scripts/image-scraper.mjs act --session "C:\path\session.json" --context find-posts-grid --key PGDN
node scripts/image-scraper.mjs act --session "C:\path\session.json" --context find-posts-grid --done
```

## Save or import an image

```powershell
node scripts/image-scraper.mjs save `
  --session "C:\path\session.json" `
  --input "C:\path\frame.png" `
  --crop-box "0.05,0.08,0.74,0.95" `
  --name "sunset toast on beach" `
  --description "Three people raise glasses in silhouette against an orange beach sunset." `
  --tags "sunset,beach,toast" `
  --whatsapp-rating 5 `
  --whatsapp-reason "Warm and immediately readable on a phone." `
  --analysis-file "C:\path\image-analysis.json"
```

Choose one crop mode allowed by the workflow: `--crop-box L,T,R,B`, `--heuristic`, or `--full-window`. The source PNG must belong to the session directory. SHA-256 deduplication applies to the entire collection.

For a principal still image exposed directly by a normal website:

```powershell
node scripts/image-scraper.mjs import-image `
  --root "C:\path\collection" `
  --url "https://example.com/assets/team-photo.webp" `
  --source-page "https://example.com/about" `
  --collection "Campaign references" `
  --target-label "example-about" `
  --platform web `
  --name "equipo reunido en recepción" `
  --description "Cinco integrantes del equipo posan en una recepción iluminada." `
  --whatsapp-rating 5 `
  --whatsapp-reason "Presenta al equipo con claridad." `
  --analysis-file "C:\path\image-analysis.json"
```

Choose exactly one of `--url IMAGE_URL` or `--input LOCAL_IMAGE`. A local input requires `--source-page URL`. PNG, JPEG, and still WebP up to 25 MB are accepted. Every retained image receives an adjacent Markdown knowledge asset with the same basename.

Apply or replace a deep analysis later:

```powershell
node scripts/image-scraper.mjs analyze-image --root "C:\path\collection" --image "C:\path\collection\...\media\001-team-photo.webp" --analysis-file "C:\path\image-analysis.json"
```

## Video ingestion and analysis

```powershell
node scripts/image-scraper.mjs import-video `
  --root "C:\path\collection" `
  --input "C:\path\source.mp4" `
  --source-page "https://example.com/post/123" `
  --platform web `
  --source-account "example" `
  --name "demostración de producto en estudio" `
  --config "C:\path\content-config.json" `
  --ffmpeg-path "C:\tools\ffmpeg.exe" `
  --ffprobe-path "C:\tools\ffprobe.exe" `
  --whisper-path "C:\tools\whisper.exe" `
  --analysis-file "C:\path\video-analysis.json"
```

Choose exactly one of `--input LOCAL_VIDEO` or `--url DIRECT_VIDEO_URL`. Local files require `--source-page` for provenance. The command preserves the original, probes technical metadata, detects scene cuts and spaced meaningful changes, removes visually redundant keyframes, builds the scene hierarchy, optionally extracts/transcribes audio, and writes `video.md` plus `metadata.json`. The configured download limit defaults to 1 GiB.

Useful per-run overrides include `--max-videos-per-source`, `--max-download-bytes`, `--hard-scene-threshold`, `--soft-scene-threshold`, `--meaningful-change-gap-seconds`, `--max-keyframes`, `--perceptual-hamming-threshold`, `--no-audio`, and `--transcribe`.

Apply deep video and per-scene keyframe analysis later:

```powershell
node scripts/image-scraper.mjs analyze-video --root "C:\path\collection" --video-root "C:\path\collection\assets\videos\product-demo" --analysis-file "C:\path\video-analysis.json"
```

## Recovery, reports, and completion

```powershell
node scripts/image-scraper.mjs backfill --root "C:\path\collection"
node scripts/image-scraper.mjs backfill --root "C:\path\collection" --force
node scripts/image-scraper.mjs index --root "C:\path\collection"
node scripts/image-scraper.mjs report --root "C:\path\collection" --title "Referencias" --language es --max-recommendations 5
```

`backfill` creates missing image twins and technical metadata without re-downloading originals. `index` writes `content-manifest.json` and the three reports under `reports/`. Re-running video import with the same SHA-256 resumes from the completed asset instead of duplicating it.

Record a rejected frame or finish a browser source:

```powershell
node scripts/image-scraper.mjs reject --session "C:\path\session.json" --input "C:\path\frame.png" --reason "Viewer is not open" --media-type grid
node scripts/image-scraper.mjs finish --session "C:\path\session.json" --status partial --summary "Captured three useful stills." --reason "No next item was visible"
```

`finish` is idempotent, closes the Edge window unless `--keep-open` was used, and regenerates reports.

## Evidence-only page capture

```powershell
node scripts/image-scraper.mjs capture-page --url "https://example.com" --shots 3 --step-pages 1 --confirm-live-ui
```

Sequential viewport captures are raw evidence, not curated knowledge assets. They remain in their page-capture manifest but are excluded from the consolidated image inventory until deliberately cropped and saved.
