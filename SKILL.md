---
name: windows-visual-image-scraper
description: Capture page screenshots or extract visible images through a real Microsoft Edge session on Windows. Codex or another image-capable code agent inspects local PNG screenshots and directs bounded mouse or keyboard actions; bundled scripts handle native Windows capture, cropping, deduplication, and manifests without calling an AI API. Use when an authenticated or browser-rendered surface must be operated through visible Windows UI. Do not use for ordinary HTTP downloads, DOM-first automation, non-Windows hosts, or bypassing access controls.
metadata:
  short-description: Agent-guided image capture through visible Edge UI
---

# Windows Visual Image Scraper

Act as the visual planner. The bundled CLI is a deterministic Windows control layer: it opens Edge, captures PNG files, executes one validated action at a time, crops accepted frames, and records an audit trail. It never calls OpenAI or another AI service and does not require a separate API key. Use the model already running in Codex or the host code agent to inspect screenshots.

Resolve the skill directory from this `SKILL.md` location and invoke `scripts/image-scraper.mjs` by absolute path. Keep the caller's working directory unchanged so relative output paths land in the active task workspace.

## Before a live session

- Confirm the host is Windows and the user asked to operate the browser for this task.
- Warn that local execution temporarily takes focus and can move the pointer. Do not infer `--confirm-live-ui` authorization from an unrelated task.
- Keep the interactive desktop unlocked and the selected Edge profile signed in. Use `--pause-for-login` for manual authentication; never request or automate credentials.
- Put outputs in the current task workspace unless the user names another location.
- Run `node scripts/image-scraper.mjs doctor` on first use or after an environment failure.
- Run `start ... --dry-run` before opening Edge.
- Confirm that the host agent can inspect local PNG files. In Codex, use the local image-viewing tool. If no image-viewing capability is available, stop and hand control to the user; never infer screen state from filenames or logs.

Read [references/cli.md](references/cli.md) before a live session. Read [references/workflow-schema.md](references/workflow-schema.md) when creating or modifying a workflow. For focus and screenshot constraints, read [references/windows-runtime.md](references/windows-runtime.md). For isolated execution, read [references/vm-setup.md](references/vm-setup.md).

## Choose a mode

- Use `capture-page` for deterministic sequential viewport screenshots.
- Use `facebook-photos` for a Facebook profile's own-photo viewer.
- Use `instagram-photo-posts` for still-image Instagram publications.
- Use `generic-lightbox-gallery` for a conventional gallery that advances with Right Arrow.
- Create a workflow JSON for another visual gallery.

## Agent-native extraction loop

1. Validate the workflow and dry-run `start`.
2. Start a live session with current-task authorization. Save the returned `sessionPath` and `screenshotPath`.
3. Inspect the PNG itself. Follow the returned stage goal, guidance, allowed actions, and remaining step budget.
4. Execute exactly one bounded action with `act`. Inspect the new screenshot returned by that command. Use `--done` when the stage goal is visibly satisfied, then continue with the next workflow stage.
5. In `collection` context, apply `inspectionPrompt` to the visible pixels. For an accepted still image, call `save` with agent-selected crop ratios or an allowed local heuristic. Otherwise call `reject` with a concrete reason.
6. Advance exactly one item using the workflow's declared strategy, inspect the returned screenshot, and repeat until the requested count is reached or no next item exists.
7. Always call `finish`, including after a failure. Use `partial` when useful images were saved but the requested count was not reached.
8. Inspect `manifest.json` before reporting success. Never claim a capture solely because an action completed.

Do not batch speculative clicks. Stop if the screenshot shows a CAPTCHA, checkpoint, rate limit, consent change, account-security screen, destructive control, or ambiguous state.

## Command pattern

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs start --preset generic-lightbox-gallery --url "https://example.com/gallery" --count 3 --dry-run
node scripts/image-scraper.mjs start --preset generic-lightbox-gallery --url "https://example.com/gallery" --count 3 --output ".\captures" --confirm-live-ui

# Inspect the returned PNG with the host agent, then issue one action:
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context open-first-image --click "0.25,0.55"
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context open-first-image --done

# Inspect a collection frame, then save or reject it:
node scripts/image-scraper.mjs shot --session "C:\path\to\session.json" --context collection
node scripts/image-scraper.mjs save --session "C:\path\to\session.json" --input "C:\path\to\frame.png" --crop-box "0.05,0.08,0.74,0.95"
node scripts/image-scraper.mjs act --session "C:\path\to\session.json" --context collection --key RIGHT
node scripts/image-scraper.mjs finish --session "C:\path\to\session.json" --status complete
```

`capture-page` remains available for non-agentic page screenshots. Every live opening command requires `--confirm-live-ui`; session continuation commands are bound to the saved window handle and constrained by the workflow.
