# CLI reference

Run commands from the skill directory or invoke the script by absolute path. All output paths are resolved against the caller's current directory.

After cloning or copying the skill, install its one runtime dependency once with `npm install` from the skill directory.

## Read-only commands

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs list-presets
node scripts/image-scraper.mjs validate-workflow --all
node scripts/image-scraper.mjs validate-workflow --workflow "C:\path\to\workflow.json"
```

`doctor` checks the operating system, Node.js, PowerShell helper, Edge installation, and whether visual reasoning is configured. It does not open or control Edge.

## Capture page viewports

```powershell
node scripts/image-scraper.mjs capture-page `
  --url "https://example.com" `
  --output ".\captures" `
  --profile "Default" `
  --shots 3 `
  --step-pages 1 `
  --confirm-live-ui
```

Options:

- `--url`: required HTTP or HTTPS URL.
- `--output`: base output directory; defaults to `image-scraper-output`.
- `--profile`: Edge profile directory name; defaults to `Default`.
- `--shots`: 1–50 screenshots.
- `--step-pages`: 0–20 `PageDown` presses between screenshots.
- `--wait-ms`: render wait after navigation; defaults to 1200.
- `--launch-wait-ms`: initial page load wait; defaults to 4000.
- `--pause-for-login`: wait for Enter before automation begins.
- `--no-fullscreen`: do not use F11.
- `--no-reset-scroll`: do not send Home before the first screenshot.
- `--keep-open`: leave the created Edge window open.
- `--dry-run`: validate and print the resolved plan without touching the UI.
- `--confirm-live-ui`: required for an actual run.

## Run an extraction workflow

```powershell
node scripts/image-scraper.mjs run `
  --preset instagram-photo-posts `
  --url "https://www.instagram.com/example/" `
  --count 5 `
  --output ".\captures" `
  --profile "Default" `
  --confirm-live-ui
```

Bundled presets are `facebook-photos`, `instagram-photo-posts`, and `generic-lightbox-gallery`.

Use either `--preset NAME` or `--workflow PATH`, not both.

Additional options:

- `--count`: requested accepted images, capped at 100 and by workflow policy.
- `--model`: visual model override. Prefer `WINDOWS_IMAGE_SCRAPER_MODEL` for stable configuration.
- `--reasoning`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `--trace`: defaults on; use `--no-trace` only after a workflow is stable.
- `--pause-for-login`, `--no-fullscreen`, `--keep-open`, `--dry-run`, and `--confirm-live-ui` behave as above.

Environment variables:

```text
OPENAI_API_KEY
OPENAI_ORGANIZATION_ID
WINDOWS_IMAGE_SCRAPER_MODEL
WINDOWS_IMAGE_SCRAPER_REASONING
WINDOWS_IMAGE_SCRAPER_MAX_OUTPUT_TOKENS
```

Preset extraction requires `OPENAI_API_KEY` because the model verifies that the viewer is open and classifies visible media. Fallback coordinates only recover navigation; they do not fabricate visual confirmation.

## Outputs

Every run gets its own timestamped directory:

```text
<output>/<workflow-or-page-slug>/<timestamp>/
  manifest.json
  run.ndjson
  screenshots/
  media/
  trace/
  raw/
```

`manifest.json` is the source of truth. A `partial` status means some useful artifacts were produced but the requested count was not reached.
