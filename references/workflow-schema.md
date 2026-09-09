# Workflow schema

Read this reference only when adding or adapting a visual extraction workflow.

## Shape

```json
{
  "version": 1,
  "name": "example-gallery",
  "description": "Open a viewer and save unique still images.",
  "browser": {
    "fullscreen": true,
    "launchWaitMs": 4000
  },
  "stages": [
    {
      "id": "open-viewer",
      "goal": "Open the first image in the visible gallery.",
      "guidance": "Avoid navigation and account controls.",
      "allowedActionTypes": ["click", "key", "wait", "done"],
      "allowedKeys": ["HOME", "PGDN", "END", "ESC", "ENTER"],
      "maxSteps": 6,
      "forceFallbackAfterStep": 3,
      "mustActBeforeDone": true,
      "settleMs": 900,
      "fallbackActions": [
        { "type": "click", "xRatio": 0.25, "yRatio": 0.70 },
        { "type": "wait", "waitMs": 900 },
        { "type": "done" }
      ]
    }
  ],
  "collection": {
    "defaultCount": 5,
    "maxCount": 25,
    "maxAttemptsPerItem": 8,
    "inspectionPrompt": "Accept only when a still image is open in the viewer.",
    "crop": {
      "mode": "vision-or-heuristic",
      "searchRightRatio": 0.75,
      "padding": 4,
      "refineWithVision": true
    },
    "advance": {
      "mode": "key",
      "key": "RIGHT",
      "waitMs": 700
    }
  }
}
```

## Invariants

- `version` must be `1`.
- `name` must be lowercase hyphen-case.
- A workflow may have at most 20 stages; each stage may have at most 30 steps.
- Supported actions are `click`, `key`, `wait`, and `done`.
- Supported keys are `HOME`, `END`, `PGDN`, `LEFT`, `RIGHT`, `ESC`, `ENTER`, `SPACE`, and `F11`.
- Click coordinates are ratios from 0 through 1 relative to the captured Edge window.
- Workflows cannot execute shell commands, JavaScript, arbitrary PowerShell, URLs, or filesystem operations.
- The URL always comes from the live CLI invocation. Do not embed account-specific URLs in reusable workflows.
- `collection.inspectionPrompt` determines whether a frame is accepted. Make rejection criteria explicit.

## Crop modes

- `vision`: require a crop box from visual inspection.
- `vision-or-heuristic`: prefer the visual crop box, then scan the screenshot for the dominant active image region.
- `heuristic`: use pixel scanning without a crop box from the model.
- `none`: retain the full Edge-window screenshot.

`refineWithVision` performs one additional crop review on the saved image and rewrites it only when the proposed reduction is meaningful.

## Advance modes

- `key`: send one whitelisted key.
- `click`: click a fixed ratio.
- `vision`: ask for the visible next-item control and execute a bounded `click`, `wait`, or `done` loop.

For a carousel, state whether the workflow should advance inside the current item or move to the next publication. Never leave that distinction implicit.
