# Video analysis contract

Video is disabled by default. When enabled, each retained video directory contains the original file, `metadata.json`, `video.md`, and scene directories with representative keyframes and twin Markdown files.

Use [the video JSON template](../assets/templates/video-analysis.json) as the deep-analysis input. It contains a `video` object and an optional `keyframes` map keyed by scene id. The renderer validates the video fields and writes stable sections for summary, type, hook, narrative, timeline, scenes, camera, perspective, lighting, art direction, editing, color, typography, audio/transcript, communication technique, essential/arbitrary elements, effectiveness, recreation recipe, shot list, prompt, variations, and evidence limits.

`metadata.json` is the operational source of truth and records:

- source adapter/platform, exact URL/page/account, acquisition method, and capture time;
- original local path and SHA-256;
- duration, size, resolution, FPS, codecs, sample rate, channels, and audio presence;
- scene boundaries and scene-to-keyframe relationships;
- exact and perceptual hashes for keyframes;
- rejected redundant keyframes and their duplicate targets;
- audio/transcription status;
- analysis status, errors, and retryability.

## Acquisition boundaries

`import-video` accepts a local authorized file or direct HTTP(S) media URL. If neither is available, `capture-video` can record a visibly playing, authorized video from a selected Windows screen region and then feed that local MP4 into the same pipeline. Screen recording requires live-UI acknowledgement, a bounded duration, and an explicit region or full-desktop choice. Region capture is preferred because it reduces interface, notifications, and unrelated private content. Audio is optional and requires the exact name of a Windows DirectShow capture device.

Visible recording is a fidelity-limited fallback and must be described as `visible-screen-recording` in provenance. It is not an original download. Inspect the output for player controls, notifications, black/protected frames, dropped motion, and missing audio before deep analysis. The workflow does not export Edge cookies, copy profiles, bypass DRM, derive expiring hidden URLs, or use recording to defeat a protected black screen. If capture is not permitted or usable, record a partial acquisition error and continue with other assets.

## Scene and keyframe behavior

Scene detection combines FFmpeg scene scoring with meaningful-change sampling and then removes redundancy using SHA-256 plus structural/color fingerprints. Thresholds are centralized and configurable. This avoids naïve “one frame every N seconds” behavior while still detecting significant changes in long takes.

Keyframe twins use the image contract plus `parent_video`, `scene`, `timestamp`, `scene_start`, `scene_end`, and `frame_role`.

## Audio

When audio exists and extraction is enabled, the pipeline writes mono 16 kHz `audio.wav`. Transcription is opt-in. If Whisper CLI is unavailable, the video remains usable, the missing dependency is recorded, and processing continues.

## Commands

```powershell
node scripts/image-scraper.mjs doctor-video
node scripts/image-scraper.mjs import-video --root COLLECTION --input ".\reel.mp4" --source-page URL --platform instagram --source-account HANDLE --name "demostracion-producto-en-cocina" --config ".\content-config.json"
node scripts/image-scraper.mjs capture-video --root COLLECTION --source-page URL --platform instagram --source-account HANDLE --name "demostracion-visible" --duration-seconds 45 --capture-box "320,180,1280,720" --confirm-live-ui
node scripts/image-scraper.mjs analyze-video --root COLLECTION --video-root ".\assets\videos\demostracion-producto-en-cocina" --analysis-file ".\video-analysis.json"
```
