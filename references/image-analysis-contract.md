# Image analysis contract

Every retained image and video keyframe must have a sibling Markdown file with the same basename. `save` and `import-image` create it immediately. `backfill` creates missing twins for legacy assets. A baseline twin uses `analysis_status: basic`; it is structurally complete but must not be presented as deep creative analysis. Supplying `--analysis-file` or running `analyze-image` replaces it with `analysis_status: analyzed`.

Use [the image JSON template](../assets/templates/image-analysis.json) as the input contract. The deterministic renderer validates required fields and produces these stable sections:

1. Resumen
2. Descripción visual detallada
3. Propósito de la pieza
4. Mensaje e intención
5. Composición visual
6. Iluminación
7. Cámara y fotografía
8. Dirección de arte
9. Diseño gráfico y tipografía
10. Color y tratamiento
11. Elementos que hacen efectiva la pieza
12. Elementos reutilizables como inspiración
13. Qué NO es necesario copiar
14. Receta de recreación conceptual
15. Prompt base para generación
16. Variaciones posibles
17. Hechos, inferencias y límites
18. Observaciones

Frontmatter records schema version, asset type, analysis status/confidence, platform, exact source URL/page, local path, capture time, SHA-256, dimensions, and aspect ratio. Keyframes additionally record parent video, scene, timestamp, scene bounds, and frame role.

## Evidence discipline

- Put directly visible facts in `observed`.
- Put purpose, technique, or equipment estimates in `inferred` and use language such as “aparenta”, “probablemente”, or “compatible con”.
- Put unsupported specifics in `unknown`; never invent camera, lens, LUT, font family, software, identity, or location.
- `reusableElements` contains abstract creative principles.
- `nonEssentialElements` identifies incidental details that should change in a reinterpretation.
- Generation prompts must request an original execution, not replication of people, logos, products, or accidental details.

## Commands

```powershell
node scripts/image-scraper.mjs save ... --analysis-file ".\image-analysis.json"
node scripts/image-scraper.mjs import-image ... --analysis-file ".\image-analysis.json"
node scripts/image-scraper.mjs analyze-image --root COLLECTION --image IMAGE --analysis-file ".\image-analysis.json"
node scripts/image-scraper.mjs backfill --root COLLECTION
```

`backfill --force` regenerates baseline twins. Do not use `--force` on manually enriched twins unless replacement is intended.
