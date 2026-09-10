# Content configuration

Configuration is versioned JSON so the dependency-free Node CLI can validate it consistently on Windows. Create a complete file with:

```powershell
node scripts/image-scraper.mjs init-config --output ".\content-config.json"
node scripts/image-scraper.mjs validate-config --config ".\content-config.json"
```

See [the complete template](../assets/templates/content-config.json).

Important defaults:

- `media.images: true`
- `media.videos: false`
- `video.enabled: false`
- `video.maxVideosPerSource: 10`
- `video.maxDownloadBytes: 1073741824` (1 GiB)
- hard scene threshold `0.32`
- soft meaningful-change threshold `0.08`
- meaningful-change gap `8` seconds
- perceptual keyframe deduplication enabled
- audio extraction enabled; transcription disabled

CLI flags such as `--max-videos-per-source`, `--max-download-bytes`, `--hard-scene-threshold`, `--soft-scene-threshold`, `--meaningful-change-gap-seconds`, `--max-keyframes`, `--perceptual-hamming-threshold`, `--no-audio`, and `--transcribe` override the loaded file for one video invocation. `--scene-threshold` remains a compatibility alias for `--hard-scene-threshold`. Values are validated and are never hardcoded inside provider-specific code.

If the user already supplied sources and media choices, construct the configuration without asking again. If sources are missing, ask only for missing URLs or offer official-source discovery. If media choice is missing, ask whether to use images only or images plus video; images remain the default.
