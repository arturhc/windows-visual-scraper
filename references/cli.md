# CLI reference

Run commands from the skill directory or invoke `scripts/image-scraper.mjs` by absolute path. Output paths resolve against the caller's current directory. The CLI has no external runtime dependencies and makes no AI API calls.

## Read-only commands

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs list-presets
node scripts/image-scraper.mjs validate-workflow --all
node scripts/image-scraper.mjs validate-workflow --workflow "C:\path\to\workflow.json"
node scripts/image-scraper.mjs status --session "C:\path\to\session.json"
```

`doctor` checks Windows, Node.js, the PowerShell helper, and Edge. It does not open or control Edge.

## Opening commands

`capture-page` and `start` open a new visible Edge window. Both accept:

- `--url URL`: required HTTP or HTTPS URL.
- `--output PATH`: base output directory; default `image-scraper-output`.
- `--profile NAME`: Edge profile directory name; default `Default`.
- `--launch-wait-ms N`: initial load delay from 0 through 60000; default 4000.
- `--wait-ms N`: default post-action delay; default 1200.
- `--pause-for-login`: pause for manual sign-in before automation continues.
- `--no-fullscreen`: do not send F11.
- `--keep-open`: leave the created window open when finishing.
- `--dry-run`: validate and print a plan without opening Edge or generating input.
- `--confirm-live-ui`: required for live execution.

### Capture sequential viewports

```powershell
node scripts/image-scraper.mjs capture-page --url "https://example.com" --shots 3 --step-pages 1 --confirm-live-ui
```

- `--shots N`: 1 through 50 screenshots.
- `--step-pages N`: 0 through 20 PageDown presses between screenshots.
- `--no-reset-scroll`: do not send Home before the first screenshot.

### Start an agent-native extraction session

```powershell
node scripts/image-scraper.mjs start --preset instagram-photo-posts --url "https://www.instagram.com/example/" --count 5 --confirm-live-ui
```

Use exactly one of `--preset NAME` or `--workflow PATH`. `--count` is capped at 100 and by workflow policy. `run` remains an alias for `start` for compatibility, but now starts an agent session rather than an autonomous extraction loop.

The result includes `sessionPath`, a local PNG `screenshotPath`, and workflow `instructions` for the host agent.

## Session commands

### Capture a fresh frame

```powershell
node scripts/image-scraper.mjs shot --session "C:\path\to\session.json" --context open-first-post --label after-login
```

`--context` is a workflow stage id or `collection`. Include it to receive the relevant instructions.

### Execute one action

```powershell
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context open-first-post --click "0.20,0.74"
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --key PGDN
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --wait-ms 900
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context find-posts-grid --done
```

Choose exactly one action:

- `--click X,Y`: window-relative ratios from 0 through 1.
- `--key KEY`: key allowed by both the global allowlist and current workflow context.
- `--wait-ms N`: wait 0 through 60000 ms without input.
- `--done`: mark the context visibly satisfied.

Each call validates and executes one action, waits for rendering, and returns a new screenshot. It cannot run shell commands or arbitrary key combinations.

### Save an accepted image

```powershell
node scripts/image-scraper.mjs save --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --crop-box "0.05,0.08,0.74,0.95"
node scripts/image-scraper.mjs save --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --heuristic
node scripts/image-scraper.mjs save --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --full-window
```

Choose exactly one method permitted by the workflow. The input must be a PNG inside the session directory. The result is SHA-256 deduplicated.

### Reject a frame

```powershell
node scripts/image-scraper.mjs reject --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --reason "Viewer is not open" --media-type grid
```

The rejection is recorded in `manifest.json` and `run.ndjson`.

### Finish and clean up

```powershell
node scripts/image-scraper.mjs finish --session "C:\path\to\session.json" --status partial --reason "No next item was visible"
```

Status must be `complete`, `partial`, or `failed`. `finish` leaves fullscreen and closes the created Edge window unless started with `--keep-open`. Repeating it is safe.

## Outputs

Every run has a timestamped directory with `session.json`, `manifest.json`, `run.ndjson`, `screenshots/`, `media/`, `trace/`, and `raw/`. `manifest.json` is the source of truth.
