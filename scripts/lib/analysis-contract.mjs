const IMAGE_REQUIRED_TEXT = [
  "summary",
  "detailedVisualDescription",
  "purpose",
  "messageAndIntent",
  "composition",
  "lighting",
  "cameraPhotography",
  "artDirection",
  "graphicDesignTypography",
  "colorTreatment",
  "effectiveness",
  "recreationRecipe",
];

const VIDEO_REQUIRED_TEXT = [
  "executiveSummary",
  "contentType",
  "hook",
  "narrativeStructure",
  "camera",
  "lighting",
  "artDirection",
  "editing",
  "colorTreatment",
  "textTypography",
  "audio",
  "communicationTechnique",
  "whyItWorks",
  "recreationRecipe",
  "creativePrompt",
];

function text(value, fallback = "No determinado con la evidencia disponible.") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function list(value, fallback = "No determinado con la evidencia disponible.") {
  const values = Array.isArray(value) ? value.map((item) => text(item, "")).filter(Boolean) : [];
  return values.length ? values : [fallback];
}

function assertDetailed(input, fields, kind) {
  for (const field of fields) {
    if (text(input[field], "").length < 8) throw new Error(`${kind} analysis.${field} must contain meaningful text.`);
  }
}

function normalizeConfidence(value) {
  const confidence = String(value || "medium").toLowerCase();
  if (!new Set(["low", "medium", "high"]).has(confidence)) throw new Error("analysis.confidence must be low, medium, or high.");
  return confidence;
}

export function normalizeImageAnalysis(input = {}, { basic = false } = {}) {
  if (!basic) assertDetailed(input, IMAGE_REQUIRED_TEXT, "image");
  return {
    schemaVersion: 1,
    status: basic ? "basic" : "analyzed",
    confidence: normalizeConfidence(input.confidence),
    summary: text(input.summary),
    detailedVisualDescription: text(input.detailedVisualDescription),
    purpose: text(input.purpose),
    messageAndIntent: text(input.messageAndIntent),
    composition: text(input.composition),
    lighting: text(input.lighting),
    cameraPhotography: text(input.cameraPhotography),
    artDirection: text(input.artDirection),
    graphicDesignTypography: text(input.graphicDesignTypography),
    colorTreatment: text(input.colorTreatment),
    effectiveness: text(input.effectiveness),
    reusableElements: list(input.reusableElements),
    nonEssentialElements: list(input.nonEssentialElements),
    recreationRecipe: text(input.recreationRecipe),
    generationPrompts: list(input.generationPrompts),
    variations: list(input.variations),
    observations: text(input.observations),
    observed: list(input.observed),
    inferred: list(input.inferred),
    unknown: list(input.unknown),
  };
}

export function normalizeVideoAnalysis(input = {}, { basic = false } = {}) {
  if (!basic) assertDetailed(input, VIDEO_REQUIRED_TEXT, "video");
  return {
    schemaVersion: 1,
    status: basic ? "basic" : "analyzed",
    confidence: normalizeConfidence(input.confidence),
    executiveSummary: text(input.executiveSummary),
    contentType: text(input.contentType),
    hook: text(input.hook),
    narrativeStructure: text(input.narrativeStructure),
    timeline: list(input.timeline),
    camera: text(input.camera),
    apparentLensPerspective: text(input.apparentLensPerspective),
    lighting: text(input.lighting),
    artDirection: text(input.artDirection),
    editing: text(input.editing),
    colorTreatment: text(input.colorTreatment),
    textTypography: text(input.textTypography),
    audio: text(input.audio),
    transcript: list(input.transcript, "No se generó transcripción."),
    communicationTechnique: text(input.communicationTechnique),
    essentialElements: list(input.essentialElements),
    arbitraryElements: list(input.arbitraryElements),
    whyItWorks: text(input.whyItWorks),
    recreationRecipe: text(input.recreationRecipe),
    shotList: list(input.shotList),
    creativePrompt: text(input.creativePrompt),
    variations: list(input.variations),
    observed: list(input.observed),
    inferred: list(input.inferred),
    unknown: list(input.unknown),
  };
}

function yamlValue(value) {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function frontmatter(values) {
  return ["---", ...Object.entries(values).map(([key, value]) => `${key}: ${yamlValue(value)}`), "---", ""].join("\n");
}

function bullets(values) {
  return list(values).map((value) => `- ${value}`).join("\n");
}

export function renderImageAnalysisMarkdown(asset, analysisValue) {
  const analysis = normalizeImageAnalysis(analysisValue, { basic: analysisValue?.status === "basic" });
  return `${frontmatter({
    schema_version: 1,
    asset_type: asset.assetType || "image",
    analysis_status: analysis.status,
    analysis_confidence: analysis.confidence,
    source_platform: asset.sourcePlatform,
    source_url: asset.sourceUrl,
    source_page: asset.sourcePage,
    local_file: asset.localFile,
    captured_at: asset.capturedAt,
    content_hash: asset.contentHash,
    width: asset.width,
    height: asset.height,
    aspect_ratio: asset.aspectRatio,
    parent_video: asset.parentVideo,
    scene: asset.scene,
    timestamp: asset.timestamp,
    scene_start: asset.sceneStart,
    scene_end: asset.sceneEnd,
    frame_role: asset.frameRole,
  })}# Resumen

${analysis.summary}

# Descripción visual detallada

${analysis.detailedVisualDescription}

# Propósito de la pieza

${analysis.purpose}

# Mensaje e intención

${analysis.messageAndIntent}

# Composición visual

${analysis.composition}

# Iluminación

${analysis.lighting}

# Cámara y fotografía

${analysis.cameraPhotography}

# Dirección de arte

${analysis.artDirection}

# Diseño gráfico y tipografía

${analysis.graphicDesignTypography}

# Color y tratamiento

${analysis.colorTreatment}

# Elementos que hacen efectiva la pieza

${analysis.effectiveness}

# Elementos reutilizables como inspiración

${bullets(analysis.reusableElements)}

# Qué NO es necesario copiar

${bullets(analysis.nonEssentialElements)}

# Receta de recreación conceptual

${analysis.recreationRecipe}

# Prompt base para generación

${bullets(analysis.generationPrompts)}

# Variaciones posibles

${bullets(analysis.variations)}

# Hechos, inferencias y límites

## Observado

${bullets(analysis.observed)}

## Inferido

${bullets(analysis.inferred)}

## Desconocido

${bullets(analysis.unknown)}

# Observaciones

${analysis.observations}
`;
}

export function renderVideoAnalysisMarkdown(asset, analysisValue, scenes = []) {
  const analysis = normalizeVideoAnalysis(analysisValue, { basic: analysisValue?.status === "basic" });
  const sceneText = scenes.length
    ? scenes.map((scene) => `## ${scene.id} — ${scene.startSeconds.toFixed(3)}s a ${scene.endSeconds.toFixed(3)}s\n\n- Rol: ${scene.frameRole}\n- Keyframe: ${scene.keyframe}\n- Tipo de cambio: ${scene.boundaryType}\n`).join("\n")
    : "No se detectaron escenas.";
  return `${frontmatter({
    schema_version: 1,
    asset_type: "video",
    analysis_status: analysis.status,
    analysis_confidence: analysis.confidence,
    source_platform: asset.sourcePlatform,
    source_url: asset.sourceUrl,
    source_page: asset.sourcePage,
    local_file: asset.localFile,
    captured_at: asset.capturedAt,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
    video_codec: asset.videoCodec,
    audio_present: asset.audioPresent,
    audio_codec: asset.audioCodec,
    content_hash: asset.contentHash,
    scene_count: scenes.length,
  })}# Resumen ejecutivo

${analysis.executiveSummary}

# Tipo de contenido

${analysis.contentType}

# Hook

${analysis.hook}

# Estructura narrativa

${analysis.narrativeStructure}

# Timeline

${bullets(analysis.timeline)}

# Escenas

${sceneText}
# Cámara

${analysis.camera}

# Lente / perspectiva aparente

${analysis.apparentLensPerspective}

# Iluminación

${analysis.lighting}

# Dirección de arte y entorno

${analysis.artDirection}

# Edición

${analysis.editing}

# Color / grading / filtros

${analysis.colorTreatment}

# Texto y tipografía

${analysis.textTypography}

# Audio

${analysis.audio}

## Transcripción

${bullets(analysis.transcript)}

# Técnica de comunicación

${analysis.communicationTechnique}

# Elementos creativos esenciales

${bullets(analysis.essentialElements)}

# Elementos arbitrarios

${bullets(analysis.arbitraryElements)}

# Por qué funciona

${analysis.whyItWorks}

# Receta de recreación conceptual

${analysis.recreationRecipe}

# Shot list reutilizable

${bullets(analysis.shotList)}

# Prompt creativo base

${analysis.creativePrompt}

# Variaciones

${bullets(analysis.variations)}

# Hechos, inferencias y límites

## Observado

${bullets(analysis.observed)}

## Inferido

${bullets(analysis.inferred)}

## Desconocido

${bullets(analysis.unknown)}
`;
}

export function baselineImageAnalysis(description) {
  const visible = text(description, "Activo visual pendiente de análisis detallado.");
  return normalizeImageAnalysis({
    status: "basic",
    confidence: "low",
    summary: visible,
    detailedVisualDescription: visible,
    observed: [visible],
    inferred: ["El propósito y la intención requieren revisión visual detallada."],
    unknown: ["Cámara, lente, iluminación técnica, tipografía exacta y contexto de publicación no confirmados."],
  }, { basic: true });
}

export function baselineVideoAnalysis(metadata) {
  return normalizeVideoAnalysis({
    status: "basic",
    confidence: "low",
    executiveSummary: `Video local de ${Number(metadata.duration || 0).toFixed(2)} segundos pendiente de síntesis creativa detallada.`,
    observed: [`Resolución ${metadata.width || "desconocida"}x${metadata.height || "desconocida"}; ${metadata.sceneCount || 0} segmentos visuales detectados.`],
    inferred: ["La intención creativa requiere análisis multimodal de escenas, texto y audio."],
    unknown: ["Equipo de cámara, lente, LUT, software de edición y contexto no confirmado."],
  }, { basic: true });
}
