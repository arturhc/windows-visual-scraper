# Windows runtime and recovery

The runtime uses a real Edge process and Win32 input. It does not inspect the DOM, intercept network traffic, export cookies, or duplicate a browser profile.

## Operational constraints

- `CopyFromScreen` records pixels currently visible on the desktop. Keep Edge unobstructed.
- `SendKeys` and mouse events target the foreground window. Avoid using the local keyboard or mouse during a run.
- Fullscreen makes screenshot geometry more consistent but temporarily changes Edge with F11.
- Locked desktops, disconnected RDP sessions, secure-desktop prompts, display changes, browser zoom changes, and login overlays can invalidate a run.
- The runtime identifies the Edge window by comparing handles before and after `--new-window`, then prefers a matching process and title.
- The pointer is restored after each generated click.
- Only the Edge window created for the run is closed during cleanup.

## Recovery order

1. Inspect `manifest.json`, then `run.ndjson`.
2. Inspect the last stage screenshot in `trace/` and the last collection frame in `raw/`; correlate them with `run.ndjson`.
3. Confirm the correct Edge profile is signed in and the page is not showing a challenge or consent screen.
4. Retry with a smaller count.
5. Adjust workflow guidance before changing fallback coordinates.
6. Change coordinates only for a stable, known layout and keep them as ratios.

If a run repeatedly loses focus or captures black frames, move it to a dedicated unlocked Windows worker rather than increasing retries.

For an isolated setup, follow [vm-setup.md](vm-setup.md).
