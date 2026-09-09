---
name: windows-visual-image-scraper
description: Collect, curate, and report visible images from Facebook profiles, Instagram profiles, or browser galleries through a real Microsoft Edge session on Windows. Use when the user gives profile URLs, handles, names, or a gallery and expects Codex to find the target, operate the visible UI, choose and crop images, save them with descriptive names, recommend good WhatsApp conversation images, and deliver a structured folder plus Markdown report. Do not use for ordinary direct downloads, DOM automation, non-Windows hosts, or bypassing access controls.
metadata:
  short-description: Autonomous social image collection and report
---

# Windows Visual Image Scraper

Own the collection job from the user's high-level request to the finished deliverable. The user should be able to ask for images from a Facebook or Instagram account without naming CLI commands, coordinates, crop boxes, filenames, or report fields. Do not ask the user to drive the mouse or decide routine steps.

You are the visual reasoning engine. Inspect every returned PNG yourself, decide where to click and crop, describe accepted images, and judge their conversational usefulness. The bundled CLI only opens Edge, captures the visible window, executes one constrained action, crops locally, deduplicates, and writes artifacts. It does not call an AI API or require a separate API key.

Resolve the skill directory from this file and invoke `scripts/image-scraper.mjs` by absolute path while preserving the caller's working directory. Before an extraction job, read [references/deliverables.md](references/deliverables.md) and [references/cli.md](references/cli.md). Read [references/windows-runtime.md](references/windows-runtime.md) after a focus, screenshot, or recovery failure. Read [references/workflow-schema.md](references/workflow-schema.md) only when adapting a workflow. For isolated execution, read [references/vm-setup.md](references/vm-setup.md).

## Interpret the request

- Accept one or several Facebook/Instagram URLs, handles, account names, or a regular gallery URL.
- If the user supplies an exact URL, use it. If they give a handle or name, resolve the canonical profile with available read-only web search or browser navigation. Never silently choose among materially ambiguous accounts; ask only when disambiguation is genuinely necessary.
- Use the matching preset: `facebook-photos`, `instagram-photo-posts`, or `generic-lightbox-gallery`.
- If quantity is omitted, use the preset default and stop cleanly when the visible collection ends. Never turn an open-ended phrase into unbounded scrolling.
- Put all targets from one request under one collection root. Choose a short collection label from the task unless the user supplied one.
- A direct request to start collecting from named targets authorizes the live UI actions needed for that task. Warn once that local execution takes focus and may move the pointer, then proceed without asking for click-by-click confirmation. Manual login, CAPTCHA, checkpoint, or account-security screens still require the user.

## Execute the job

1. Run `doctor`, then dry-run each planned target. Do not open Edge if validation fails.
2. Process targets sequentially because they share one interactive desktop. Start each with `--collection`, `--target-label`, `--platform`, `--report-language` matching the user's language, a common `--output`, and `--confirm-live-ui`. Use `--pause-for-login` when authentication may be missing.
3. Open the returned `screenshotPath` with the host's local image-viewing capability. In Codex, use the local image viewer. Never infer screen state from filenames, OCR logs, workflow defaults, or prior layouts.
4. Follow each stage goal. Issue exactly one bounded `act`, inspect the returned screenshot, and repeat. Mark the stage `--done` only when its goal is visibly satisfied.
5. In `collection` context, decide whether the principal visible media meets `inspectionPrompt`. Reject videos, reels, grids, browser chrome, loading states, duplicates, low-confidence frames, or irrelevant UI.
6. For every accepted image, choose a tight crop that excludes browser chrome, comments, reactions, and navigation unless they are part of the requested evidence. Reinspect the saved image when crop quality is uncertain.
7. Save with a concrete visible-content name, factual description, optional tags, a WhatsApp rating from 1 through 5, and a short reason. Never use generic names such as `image-001`, `photo`, or `screenshot`. Do not guess a person's identity or private context from appearance.
8. Advance exactly one item according to the workflow, inspect the new frame, and continue until the requested count, end of collection, or a stopping condition.
9. Call `finish` in a `finally`-style cleanup for every session. Include a concise per-target summary and use `partial` when useful images exist but the requested count was not reached.
10. After all targets, run `report --root COLLECTION_ROOT`. Open `REPORT.md`, verify that every image link resolves, counts match manifests, descriptive filenames are present, and the WhatsApp shortlist is supported by visible evidence.

If no local image-viewing capability is available, stop and explain the missing capability. Do not degrade into blind coordinate execution.

## Deliverable contract

Return a structured collection containing source-specific session folders, descriptively named images, manifests, traces, and one consolidated `REPORT.md`. The report must include:

- totals for sources, accepted images, rejected frames, and WhatsApp recommendations;
- a Markdown summary table by account/source;
- a Markdown image table containing every accepted image, preview, filename, visible-content description, and WhatsApp rating;
- a ranked section of images that may work well in a WhatsApp conversation, with reasons;
- honest partial/failure notes and no unsupported claims.

When finished, tell the user the collection folder, report path, captured/rejected counts, and top WhatsApp candidates. Link the local report and folder when the host supports local file links.

## Selection judgment

Rate WhatsApp usefulness from visible evidence only:

- `5`: immediately understandable, expressive, well composed, and likely to start or enrich a conversation at phone size.
- `4`: strong and shareable with a clear subject or mood.
- `3`: usable with context, but ordinary, busy, or less legible on a phone.
- `2`: weak crop, unclear subject, repetitive, or unlikely to add much.
- `1`: misleading, sensitive, irrelevant, unusable, or should not be shared.

Ratings are suggestions, not permission to share. Prefer respectful, non-sensitive images. Avoid recommending content containing private data, minors in sensitive contexts, account-security UI, or material whose conversational use would be misleading.

## Safety and stopping

- Keep the desktop unlocked and the selected Edge profile signed in. Never request passwords, export cookies, or copy profile data.
- Stop on CAPTCHA, checkpoint, rate limit, consent change, account-security prompt, destructive control, or ambiguous target identity. Do not bypass them.
- Collect only content the user is authorized to access and retain.
- Preserve `manifest.json`, `run.ndjson`, screenshots, and partial media after failures.
- Close only the Edge window created for the session unless `--keep-open` was requested.
