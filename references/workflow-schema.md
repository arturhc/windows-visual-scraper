# Workflow schema

Read this reference when adding or adapting an agent-guided extraction workflow.

## Shape

```json
{
  "version": 2,
  "name": "example-gallery",
  "description": "Open a viewer and save unique still images.",
  "browser": { "fullscreen": true, "launchWaitMs": 4000 },
  "stages": [
    {
      "id": "open-viewer",
      "goal": "Open the first image in the visible gallery.",
      "guidance": "Avoid navigation and account controls.",
      "allowedActionTypes": ["click", "key", "wait", "done"],
      "allowedKeys": ["HOME", "PGDN", "END", "ESC", "ENTER"],
      "maxSteps": 6,
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
    "crop": { "mode": "agent-or-heuristic", "searchRightRatio": 0.75, "padding": 4 },
    "advance": { "mode": "key", "key": "RIGHT", "waitMs": 700 }
  }
}
```

## Invariants

- `version` must be `2`.
- Names and stage ids use lowercase hyphen-case.
- A workflow has 1 through 20 stages; each stage has 1 through 30 steps.
- Supported actions are `click`, `key`, `wait`, and `done`.
- Supported keys are `HOME`, `END`, `PGDN`, `LEFT`, `RIGHT`, `ESC`, `ENTER`, `SPACE`, and `F11`.
- Click coordinates are ratios from 0 through 1 relative to the Edge window.
- Workflows cannot execute shell commands, JavaScript, arbitrary PowerShell, URLs, or filesystem operations.
- The target URL comes from the live invocation; do not embed account-specific URLs.
- Make `collection.inspectionPrompt` explicit enough for the host agent to distinguish still images from videos, grids, placeholders, or ambiguous states.

`fallbackActions`, `forceFallbackAfterStep`, and `mustActBeforeDone` remain descriptive hints for host agents and compatibility. The CLI never executes fallback actions automatically; the agent must inspect the screenshot and request every action.

## Crop modes

- `agent`: require `save --crop-box` ratios selected by the host agent.
- `agent-or-heuristic`: allow either an agent crop box or the local pixel heuristic.
- `heuristic`: require the local dominant-image scan.
- `none`: retain the full Edge-window screenshot.

`padding` expands a selected crop by a bounded number of pixels. `searchRightRatio` limits the heuristic's horizontal search area.

## Advance modes

- `key`: send the declared whitelisted key in `collection` context.
- `click`: click the declared stable ratio in `collection` context.
- `agent`: visually locate the next item with bounded `click`, `wait`, or `done` actions. An optional `allowedKeys` array also enables selected safe keys such as `ESC` and `PGDN` for recovery back to a grid.

For carousels, specify whether to advance an inner slide or the outer publication.

Calling `act --done` on the active setup stage persists its completion and moves the session to the next stage. After the last setup stage, the active context becomes `collection`; earlier stage ids are then rejected as stale.
