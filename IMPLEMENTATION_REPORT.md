# Implementation Report — Content Intelligence 0.5.0

## Estado anterior

La skill capturaba imágenes visibles mediante una sesión real de Microsoft Edge en Windows. Utilizaba flujos declarativos por plataforma, capturas de pantalla, acciones acotadas, recorte, nombres descriptivos, manifiestos por intento y un reporte consolidado orientado a selección para WhatsApp. También permitía importar imágenes principales directamente desde sitios no organizados como galería.

No existían activos analíticos gemelos, contrato multimodal estable, manifiesto central de conocimiento, video de primera clase, detección de escenas, keyframes, audio, reanudación de video ni backfill analítico.

## Capacidades existentes encontradas

- Sesiones visuales auditables con Edge, sin DOM ni extracción de cookies.
- Workflows validados para Facebook, Instagram y galerías genéricas.
- Naming semántico y metadatos editoriales obligatorios.
- Recorte explícito o heurístico y rechazo de interfaz/video/ambigüedad.
- Deduplicación exacta SHA-256 a nivel colección.
- Importación directa de PNG, JPEG y WebP estático.
- Reintentos agrupados por fuente y ranking de WhatsApp con límite exacto.
- Manifiestos por ejecución, trazas NDJSON, diagnóstico y prueba real de captura.

## Cambios realizados

La implementación existente se amplió en la misma arquitectura. Se añadieron configuración versionada, activos Markdown gemelos, contratos formales de análisis, manifiesto unificado, reportes navegables, adapters de fuente, pipeline de video, scene detection, deduplicación perceptual, audio/transcripción opcional, reanudación por hash, errores parciales y backfill. Los comandos anteriores conservan su interfaz y ahora regeneran también los índices de Content Intelligence.

## Arquitectura

La adquisición permanece separada del entendimiento:

```text
fuente → adapter → captura visual o importación directa/local
       → normalización/naming → deduplicación → análisis gemelo
       → content-manifest.json → reports/*.md

video → ffprobe → preselección FFmpeg → deduplicación visual
      → escenas/keyframes → audio opcional → análisis multimodal
      → manifiesto e índices compartidos
```

Los adapters describen capacidades de website, Instagram y Facebook sin introducir lógica de análisis específica por plataforma. Esto permite añadir proveedores sin duplicar el pipeline posterior.

## Imágenes

Se preservan extensión, naming semántico, prefijos numéricos estables y resolución de colisiones. Cada imagen curada genera obligatoriamente un `.md` con el mismo basename. El frontmatter mantiene plataforma, URLs, archivo, fecha, hash, dimensiones y aspect ratio. El cuerpo sigue un contrato estable que cubre descripción, propósito, intención, composición, iluminación, cámara aparente, dirección de arte, tipografía, color, efectividad, elementos esenciales/no esenciales, receta conceptual, prompts y variantes.

La evidencia observada se separa de inferencias e incógnitas. Si aún no hay inspección semántica profunda, el gemelo queda en estado `basic`; nunca se hace pasar un análisis provisional por completado.

## Videos

Video es opt-in y el límite predeterminado es 10 por fuente. `import-video` acepta un archivo local autorizado o una URL HTTP(S) directa accesible, conserva el original y registra fuente, cuenta/página, fecha, hash, duración, tamaño, resolución, FPS, formatos, codecs y audio. Los archivos tienen un directorio semántico con sufijo legible en caso de colisión. Entradas repetidas se reanudan por SHA-256.

Existe un techo configurable de tamaño, de 1 GiB por defecto, validado tanto con archivos locales como con `Content-Length` y bytes realmente transferidos.

## Scene detection

FFmpeg evalúa frames con su métrica nativa `scene`. El filtro conserva el inicio, cortes duros por encima de `hardThreshold` y cambios más suaves por encima de `softThreshold` cuando transcurrió `meaningfulChangeGapSeconds`. Así se representan cambios relevantes dentro de tomas largas sin recurrir a la extracción ingenua cada N segundos.

Los thresholds y el máximo de candidatos son configurables. La estrategia decodifica una vez para seleccionar barato y sólo profundiza sobre los candidatos conservados.

## Keyframes

Cada límite visual conservado inicia un segmento ordenado. El siguiente timestamp fija el final y la duración probada cierra la última escena. Cada escena guarda su frame representativo y su gemelo Markdown.

La reducción combina SHA-256, dHash estructural y distancia del color medio. La condición conjunta evita tanto redundancia visual como la eliminación incorrecta de frames estructuralmente similares con cambios relevantes de color o iluminación.

## Audio

Cuando existe una pista y la opción está habilitada, FFmpeg crea WAV mono a 16 kHz para análisis/transcripción eficiente. Whisper CLI es opcional. Su ausencia no invalida el video: se registra como error parcial reintentable y se conservan original, metadata, escenas, frames y audio.

La transcripción se mantiene separada de la interpretación analítica para no inventar diálogo ininteligible.

## Manifests y reportes

`content-manifest.json` relaciona fuentes, imágenes, videos, escenas, keyframes, hashes, estados de análisis, duplicados y errores. Los índices humanos son:

- `reports/images-index.md`
- `reports/videos-index.md`
- `reports/run-report.md`

El reporte general contabiliza activos básicos versus analizados, cobertura profunda, escenas, keyframes, duplicados y fallos. Errores ocurridos antes de poder crear metadata de video se conservan en `content-errors.ndjson` y se incorporan al manifiesto. Capturas secuenciales de viewport son evidencia y no inflan el inventario curado.

## Compatibilidad

Se conserva el identificador `windows-visual-image-scraper`, los workflows, comandos de sesión, estructura por fuente, `REPORT.md` y comportamiento image-first. Renombrar la skill habría roto prompts explícitos, rutas instaladas y automatizaciones. Los nuevos índices se generan adicionalmente.

Colecciones antiguas pueden ejecutar `backfill`: detecta imágenes referenciadas sin gemelo, agrega dimensiones/estado, crea Markdown básico y reconstruye índices sin volver a scrapear. Un video ya descargado puede procesarse con `import-video --input` manteniendo su procedencia mediante `--source-page`.

## Dependencias

- Node.js 20 o superior: runtime principal sin paquetes npm de producción.
- Microsoft Edge y PowerShell: sólo para adquisición visual Windows ya existente.
- FFmpeg y FFprobe: opcionales para imágenes, requeridos para video por rendimiento, probing y scene scoring maduros.
- Whisper CLI: opcional para transcripción.

No se agregó una dependencia pesada de visión artificial ni un SDK de IA. Codex realiza la inspección semántica; las utilidades locales hacen trabajo determinista y auditable.

## Limitaciones conocidas

- Instagram y Facebook pueden exigir login, consentimiento o controles que impiden acceder al contenido; la skill se detiene y no intenta evadirlos.
- La navegación visual identifica páginas candidatas, pero la adquisición de video requiere un archivo local autorizado o una URL directa estable. No se exportan cookies ni se descubren URLs ocultas/temporales mediante interceptación.
- FFmpeg scene scoring detecta cambios visuales globales; un cambio semántico muy pequeño puede quedar por debajo del threshold y debe ajustarse por configuración.
- dHash más color medio es eficiente y explicable, pero no sustituye embeddings semánticos para colecciones extremadamente heterogéneas.
- La transcripción depende de una instalación compatible de Whisper y de la inteligibilidad del audio.
- El análisis profundo requiere que el agente inspeccione los keyframes y el audio/transcript; el CLI no llama de forma autónoma a una API de modelos.

## Ejemplo de ejecución

```powershell
node scripts/image-scraper.mjs init-config --output .\content-config.json
node scripts/image-scraper.mjs doctor --capture-test --confirm-live-ui
node scripts/image-scraper.mjs doctor-video --ffmpeg-path C:\tools\ffmpeg.exe --ffprobe-path C:\tools\ffprobe.exe

# Captura visual de imágenes con start / shot / act / save / finish.

node scripts/image-scraper.mjs import-video `
  --root C:\Content\marca `
  --input C:\Downloads\demostracion.mp4 `
  --source-page https://example.com/videos/123 `
  --platform web `
  --name "demostración de producto en estudio" `
  --config .\content-config.json `
  --ffmpeg-path C:\tools\ffmpeg.exe `
  --ffprobe-path C:\tools\ffprobe.exe

node scripts/image-scraper.mjs analyze-video `
  --root C:\Content\marca `
  --video-root C:\Content\marca\assets\videos\demostracion-de-producto-en-estudio `
  --analysis-file .\video-analysis.json

node scripts/image-scraper.mjs backfill --root C:\Content\marca
node scripts/image-scraper.mjs index --root C:\Content\marca
```

## Archivos modificados

- `SKILL.md`, `README.md`, `agents/openai.yaml`, `package.json`, `package-lock.json`
- `scripts/image-scraper.mjs`
- `scripts/lib/agent-session.mjs`, `direct-import.mjs`, `report.mjs`
- `scripts/lib/analysis-contract.mjs`, `backfill.mjs`, `content-config.mjs`, `content-manifest.mjs`, `image-metadata.mjs`, `knowledge-assets.mjs`, `media-tools.mjs`, `source-adapters.mjs`, `video-pipeline.mjs`
- `assets/templates/content-config.json`, `image-analysis.json`, `video-analysis.json`
- `references/architecture.md`, `cli.md`, `configuration.md`, `deliverables.md`, `image-analysis-contract.md`, `output-structure.md`, `video-analysis-contract.md`, `windows-runtime.md`, `vm-setup.md`
- pruebas existentes de sesión/importación y nuevas pruebas de configuración, activos gemelos, herramientas multimedia y pipeline de video
