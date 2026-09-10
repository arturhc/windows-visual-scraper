# Collection deliverables

Use these conventions for every multi-image collection job.

## Folder plan

Pass one shared base directory with `--output` and one shared job label with `--collection`. The CLI produces:

```text
<output>/
└── <collection>/
    ├── REPORT.md
    ├── facebook-<target>/
    │   └── <timestamp>/
    │       ├── session.json
    │       ├── manifest.json
    │       ├── run.ndjson
    │       ├── media/
    │       ├── screenshots/
    │       ├── raw/
    │       └── trace/
    └── instagram-<target>/
        └── <timestamp>/
            └── ...
```

Direct imports from non-gallery pages use the same `<platform>-<target>/<timestamp>/` layout with `manifest.json`, `run.ndjson`, `media/`, and `raw/`; they do not create a browser `session.json`.

Use the same collection, output, and report-language values for every target in the user's request. The `collectionRoot` returned by `start` is the root to pass to `report`.

## Descriptive filenames

Name an image from its dominant visible subject, action, setting, and distinctive mood or color when useful. Good names are short enough to scan and specific enough to identify the image without opening it.

Examples:

- `sunset-toast-on-beach`
- `red-mural-beside-cafe-door`
- `black-dog-running-through-snow`
- `birthday-table-with-blue-balloons`

Avoid:

- generic sequence names such as `image-001`, `photo`, or `capture`;
- unverifiable identities, relationships, locations, dates, or emotions;
- sensitive traits inferred from appearance;
- engagement metrics or post text that is not clearly visible.

The CLI adds a stable numeric prefix, producing names such as `003-black-dog-running-through-snow.png`.

## Save metadata

For each accepted frame, provide all required metadata:

```powershell
node scripts/image-scraper.mjs save `
  --session "C:\path\session.json" `
  --input "C:\path\screenshots\frame.png" `
  --crop-box "0.08,0.10,0.74,0.92" `
  --name "sunset toast on beach" `
  --description "Three people raise glasses in silhouette against an orange beach sunset." `
  --tags "sunset,beach,friends,toast" `
  --whatsapp-rating 5 `
  --whatsapp-reason "Warm, expressive, and immediately legible on a phone screen."
```

Describe only visible content. The description should help the user distinguish the image and understand why it was selected.

## WhatsApp editorial criteria

Favor images that:

- have one clear subject or readable moment;
- remain understandable as a small phone preview;
- convey humor, warmth, curiosity, beauty, a reaction, or a useful discussion point;
- are well cropped and do not include distracting browser UI;
- are appropriate for the likely audience and do not expose private information.

Penalize duplicates, clutter, tiny subjects, ambiguous context, low resolution, accidental frames, sensitive content, and screenshots dominated by interface elements. Give ratings independently. Use `--max-recommendations N` to cap the ranked shortlist at the user's requested number; the default cap is 5.

## Report verification

`finish` regenerates the collection report, and `report --root PATH` rebuilds it after all sessions. Before delivery:

1. Compare report totals with the logical sources represented by all `manifest.json` files. Multiple attempts for the same platform and target count as one source, while the Attempts column preserves retry visibility.
2. Confirm each Markdown preview and file link points to an existing image.
3. Confirm every filename is descriptive and unique.
4. Confirm each WhatsApp recommendation has a concrete visible reason.
5. Add a short human-readable overview only if it improves the report; preserve the generated tables and relative links.

Exact SHA-256 duplicates are rejected across the entire collection during save/import and suppressed again while reports are rebuilt.
