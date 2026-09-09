# CLI reference

Codex normally invokes these commands after interpreting a high-level collection request. Run from the skill directory or call `scripts/image-scraper.mjs` by absolute path. Relative output paths resolve against the caller's current directory. The CLI has no external runtime dependencies and makes no AI API calls.

## Read-only commands

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs list-presets
node scripts/image-scraper.mjs validate-workflow --all
node scripts/image-scraper.mjs validate-workflow --workflow "C:\path\to\workflow.json"
node scripts/image-scraper.mjs status --session "C:\path\to\session.json"
```

`doctor` checks Windows, Node.js, PowerShell helper availability, and Edge. It does not open or control Edge.

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

`--context` is a workflow stage id or `collection`. Choose exactly one of `--click X,Y`, `--key KEY`, `--wait-ms N`, or `--done`. Every call validates the action and returns a new screenshot.

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

The input must be a PNG inside the session directory. Accepted output is deduplicated by SHA-256.

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
node scripts/image-scraper.mjs report --root "C:\path\to\collection" --title "Referencias de campaña" --language es
```

The command scans manifests recursively and writes `REPORT.md` containing source totals, an all-images Markdown table with previews and descriptions, and a ranked WhatsApp shortlist.

## Capture sequential page viewports

This deterministic mode does not use the agent session protocol:

```powershell
node scripts/image-scraper.mjs capture-page --url "https://example.com" --shots 3 --step-pages 1 --confirm-live-ui
```

Additional options are `--shots N` (1–50), `--step-pages N` (0–20), and `--no-reset-scroll`.
