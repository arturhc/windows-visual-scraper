---
name: windows-visual-image-scraper
description: Capture page screenshots or extract visible images through a real Microsoft Edge session on Windows using screenshots, constrained visual planning, mouse and keyboard input, cropping, deduplication, and trace manifests. Use when a task needs an authenticated or browser-rendered surface that should be operated through visible Windows UI. Do not use for ordinary HTTP downloads, DOM-first browser automation, non-Windows hosts, or bypassing access controls.
metadata:
  short-description: Scrape images through visible Windows browser UI
---

# Windows Visual Image Scraper

Use the bundled CLI to operate a visible Microsoft Edge window and produce auditable image artifacts. Prefer direct downloads, APIs, or DOM automation when they can obtain the requested images reliably; use this skill when the real logged-in browser surface is materially necessary.

Resolve the skill directory from this `SKILL.md` location and invoke `scripts/image-scraper.mjs` by absolute path. Keep the caller's working directory unchanged so relative output paths land in the active task workspace.

## Before a live run

- Confirm the host is Windows and the user has asked to operate the browser for the current task.
- Warn that local mode temporarily takes focus and can move the pointer. Do not pass `--confirm-live-ui` based on unrelated prior authorization.
- Keep the screen unlocked and the target Edge profile signed in. Do not request passwords or copy browser profile data.
- Put outputs inside the current task workspace unless the user specifies another location.
- Supply API credentials through `OPENAI_API_KEY`, never CLI arguments or committed files.
- If `node_modules/openai` is absent, run `npm install` in this skill directory before the first use.
- Run `node scripts/image-scraper.mjs doctor` on first use or after an environment failure.

## Choose a mode

- For sequential viewport screenshots, use `capture-page`. This mode does not require OpenAI.
- For Facebook owner photos, use preset `facebook-photos`.
- For still-image Instagram posts, use preset `instagram-photo-posts`.
- For a conventional lightbox that advances with Right Arrow, start with preset `generic-lightbox-gallery`.
- For another visual gallery or viewer, create a small workflow JSON from the documented schema and run it with `run --workflow`.

Read [references/cli.md](references/cli.md) before invoking a live command. Read [references/workflow-schema.md](references/workflow-schema.md) only when creating or modifying a workflow. For focus, screenshot, RDP, and recovery constraints, read [references/windows-runtime.md](references/windows-runtime.md).

For runs isolated from the user's main desktop, install and execute the skill inside a dedicated Windows VM; read [references/vm-setup.md](references/vm-setup.md) before configuring that environment.

## Execution contract

1. Validate the preset or workflow before opening Edge.
2. Start with conservative counts and bounded steps. Increase them only when the output demonstrates a need.
3. Use `--pause-for-login` when the session may need manual authentication; never automate credentials.
4. Allow only the action types and keys declared by the workflow. Do not extend the PowerShell helper to arbitrary shell execution.
5. After completion, inspect `manifest.json`. Report partial runs and per-item rejection reasons instead of describing them as successful.
6. Preserve `trace/` and `run.ndjson` for failed or ambiguous runs. They contain screenshots and decisions needed for diagnosis.
7. Close the created Edge window by default. Use `--keep-open` only when requested or needed for an immediate manual handoff.

## Useful commands

```powershell
node scripts/image-scraper.mjs doctor
node scripts/image-scraper.mjs capture-page --url "https://example.com" --shots 3 --confirm-live-ui
node scripts/image-scraper.mjs run --preset facebook-photos --url "https://www.facebook.com/example" --count 5 --confirm-live-ui
node scripts/image-scraper.mjs run --preset instagram-photo-posts --url "https://www.instagram.com/example/" --count 5 --confirm-live-ui
node scripts/image-scraper.mjs validate-workflow --workflow "C:\path\to\workflow.json"
```

Use `--dry-run` to resolve and validate a live command without opening Edge, sending screenshots, or generating input events.
