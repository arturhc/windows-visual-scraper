# CLI reference

Codex normally invokes these commands after interpreting a high-level collection request. Run from the skill directory or call `scripts/image-scraper.mjs` by absolute path. Relative output paths resolve against the caller's current directory. The CLI has no external runtime dependencies and makes no AI API calls.

## Read-only commands

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs doctor --capture-test --confirm-live-ui
node scripts/image-scraper.mjs list-presets
node scripts/image-scraper.mjs validate-workflow --all
node scripts/image-scraper.mjs validate-workflow --workflow "C:\path\to\workflow.json"
node scripts/image-scraper.mjs status --session "C:\path\to\session.json"
```

Plain `doctor` checks Windows, Node.js, PowerShell helper availability, and Edge without opening it. Add `--capture-test --confirm-live-ui` before a collection job to open a temporary `about:blank` Edge window, capture a real PNG, verify it is nonempty, close the window, and remove the temporary file. This catches native screenshot failures that a read-only preflight cannot detect.

## Start a collection session

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

Use exactly one of `--preset NAME` or `--workflow PATH`. `run` remains an alias for `start`.

Options:

- `--url URL`: required HTTP or HTTPS target.
- `--count N`: accepted-image target, capped at 100 and by workflow policy.
- `--output PATH`: shared base output; default `image-scraper-output`.
- `--collection NAME`: shared collection/job folder; default `social-image-collection`.
- `--target-label NAME`: readable account/source label; inferred from the URL when omitted.
- `--platform facebook|instagram|web`: inferred from the URL when omitted.
- `--report-language en|es`: generated report language; default `en`.
- `--max-recommendations N`: maximum ranked WhatsApp recommendations in generated reports; default `5`.
- `--profile NAME`: Edge profile directory; default `Default`.
- `--launch-wait-ms N`: initial load delay from 0 through 60000.
- `--wait-ms N`: default post-action delay; default 1200.
- `--pause-for-login`: pause for manual sign-in.
- `--no-fullscreen`: do not send F11.
- `--keep-open`: leave the created window open after finishing.
- `--dry-run`: validate and print the plan without touching the UI.
- `--confirm-live-ui`: required to start a live session.

The result includes `collectionRoot`, `sessionPath`, `screenshotPath`, and instructions for the first workflow stage.

## Observe and act

Capture a fresh frame:

```powershell
node scripts/image-scraper.mjs shot --session "C:\path\to\session.json" --context open-first-post --label after-login
```

Execute exactly one action:

```powershell
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context open-first-post --click "0.20,0.74"
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --key PGDN
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --wait-ms 900
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --done
```

`--context` is the active workflow stage id or `collection`. Choose exactly one of `--click X,Y`, `--key KEY`, `--wait-ms N`, or `--done`. Every call validates the action and returns a new screenshot. `--done` persists completion of the active setup stage and returns instructions for the next stage (or `collection` after the final stage); stale stage contexts are rejected.

## Save an accepted image

```powershell
node scripts/image-scraper.mjs save `
  --session "C:\path\to\session.json" `
  --input "C:\path\to\frame.png" `
  --crop-box "0.05,0.08,0.74,0.95" `
  --name "sunset toast on beach" `
  --description "Three people raise glasses in silhouette against an orange beach sunset." `
  --tags "sunset,beach,toast" `
  --whatsapp-rating 5 `
  --whatsapp-reason "Warm, expressive, and immediately readable on a phone."
```

Choose exactly one crop method permitted by the workflow:

- `--crop-box L,T,R,B`: ratios selected by Codex after inspecting the PNG.
- `--heuristic`: local dominant-image pixel scan.
- `--full-window`: only for workflow crop mode `none`.

Editorial metadata is required:

- `--name TEXT`: concrete visible-content name. Generic names are rejected. The CLI slugifies it and adds the stable item number.
- `--description TEXT`: factual visible-content description from 8 through 500 characters.
- `--whatsapp-rating 1-5`: editorial suitability score.
- `--whatsapp-reason TEXT`: score rationale from 5 through 300 characters.
- `--tags A,B,C`: optional comma-separated visible-content tags.

The input must be a PNG inside the session directory. Accepted output is deduplicated by SHA-256 against every manifest under the shared collection root.

## Import a principal image from a non-gallery page

When a normal website exposes a principal still image directly, import it without fabricating a browser session or manifest:

```powershell
node scripts/image-scraper.mjs import-image `
  --root "C:\path\to\collection" `
  --url "https://example.com/assets/team-photo.webp" `
  --source-page "https://example.com/about" `
  --collection "Campaign references" `
  --target-label "example-about" `
  --platform web `
  --report-language es `
  --name "equipo reunido en recepción" `
  --description "Cinco integrantes del equipo posan en la recepción iluminada." `
  --tags "equipo,recepción" `
  --whatsapp-rating 5 `
  --whatsapp-reason "Presenta al equipo con claridad y se entiende en pantalla pequeña."
```

Choose exactly one of `--url IMAGE_URL` or `--input LOCAL_IMAGE`. A local input also requires `--source-page URL` for provenance; a direct URL uses itself when `--source-page` is omitted. PNG, JPEG, and still WebP files up to 25 MB are accepted. GIF and video formats are rejected. Each call creates an auditable direct-import attempt, performs collection-wide SHA-256 deduplication, and regenerates `REPORT.md`.

## Reject a frame

```powershell
node scripts/image-scraper.mjs reject --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --reason "Viewer is not open" --media-type grid
```

Rejections are recorded in `manifest.json` and `run.ndjson`.

## Finish a source

```powershell
node scripts/image-scraper.mjs finish `
  --session "C:\path\to\session.json" `
  --status partial `
  --summary "Captured three useful still images before the visible collection ended." `
  --reason "No next item was visible"
```

Status is `complete`, `partial`, or `failed`. `finish` exits fullscreen, closes the created Edge window unless `--keep-open` was used, writes the source summary, and regenerates `REPORT.md` at the collection root. Repeating it is safe.

## Build the consolidated report

After all source sessions finish:

```powershell
node scripts/image-scraper.mjs report --root "C:\path\to\collection" --title "Referencias de campaña" --language es --max-recommendations 5
```

The command scans manifests recursively and writes `REPORT.md` containing logical source totals, an all-images Markdown table with previews and descriptions, and a ranked WhatsApp shortlist. Retry attempts for the same platform and target are grouped into one source and shown in an Attempts column. Exact duplicate hashes are suppressed across sources. `--max-recommendations` defaults to 5, and an explicit `whatsapp.recommended: false` is respected even when the rating is high.

## Capture sequential page viewports

This deterministic mode does not use the agent session protocol:

```powershell
node scripts/image-scraper.mjs capture-page --url "https://example.com" --shots 3 --step-pages 1 --confirm-live-ui
```

Additional options are `--shots N` (1–50), `--step-pages N` (0–20), and `--no-reset-scroll`.
