import fs from "node:fs/promises";
import path from "node:path";
import { findManifestFiles } from "./artifacts.mjs";
import { buildKnowledgeReports } from "./content-manifest.mjs";

const COPY = {
  en: {
    generated: "Generated", summary: "Summary", sourcesProcessed: "Sources processed",
    imagesCaptured: "Images captured", framesRejected: "Frames rejected", recommendations: "WhatsApp recommendations",
    source: "Source", platform: "Platform", status: "Status", attempts: "Attempts", failedAttempts: "failed",
    captured: "Captured", rejected: "Rejected", sessionSummary: "Source summary",
    capturedImages: "Captured images", noImages: "No images were captured.", preview: "Preview", file: "File", description: "Description", whatsapp: "WhatsApp",
    best: "Best options for a WhatsApp conversation", noRecommendations: "No image was marked as a WhatsApp recommendation.", rating: "Rating", image: "Image", why: "Why it may work",
    notes: "Notes", note1: "Ratings are editorial suggestions based only on visible content, composition, clarity at phone size, and conversational usefulness.",
    note2: "Verify context, consent, and audience before sharing any captured image.", note3: "`manifest.json` files remain the machine-readable source of truth.",
    notRated: "Not rated", recommended: "Recommended", maybe: "Maybe", notRecommended: "Not recommended",
  },
  es: {
    generated: "Generado", summary: "Resumen", sourcesProcessed: "Fuentes procesadas",
    imagesCaptured: "Imágenes capturadas", framesRejected: "Capturas rechazadas", recommendations: "Recomendaciones para WhatsApp",
    source: "Fuente", platform: "Plataforma", status: "Estado", attempts: "Intentos", failedAttempts: "fallidos",
    captured: "Capturadas", rejected: "Rechazadas", sessionSummary: "Resumen de la fuente",
    capturedImages: "Imágenes capturadas", noImages: "No se capturaron imágenes.", preview: "Vista previa", file: "Archivo", description: "Descripción", whatsapp: "WhatsApp",
    best: "Mejores opciones para una conversación de WhatsApp", noRecommendations: "Ninguna imagen fue marcada como recomendación para WhatsApp.", rating: "Calificación", image: "Imagen", why: "Por qué podría funcionar",
    notes: "Notas", note1: "Las calificaciones son sugerencias editoriales basadas únicamente en el contenido visible, la composición, la claridad en pantalla de teléfono y la utilidad conversacional.",
    note2: "Verifica el contexto, el consentimiento y la audiencia antes de compartir cualquier imagen.", note3: "Los archivos `manifest.json` siguen siendo la fuente de verdad legible por máquina.",
    notRated: "Sin calificar", recommended: "Recomendada", maybe: "Tal vez", notRecommended: "No recomendada",
  },
};

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function markdownAlt(value) {
  return markdownCell(value).replace(/([\[\]\\])/g, "\\$1");
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function markdownPath(root, target) {
  const relative = path.relative(root, target).replaceAll("\\", "/");
  return relative.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function sourceLabel(manifest) {
  return manifest.targetLabel || manifest.workflow || manifest.runName || "capture";
}

function sourceKey(manifest) {
  return `${manifest.platform || "web"}\u0000${sourceLabel(manifest).toLowerCase()}`;
}

function whatsappRecommended(item) {
  if (item.whatsapp?.recommended === false) return false;
  if (item.whatsapp?.recommended === true) return true;
  return (item.whatsapp?.rating || 0) >= 4;
}

function whatsappLabel(item, copy) {
  const rating = item.whatsapp?.rating;
  if (!Number.isInteger(rating)) return copy.notRated;
  const verdict = whatsappRecommended(item) ? copy.recommended : rating === 3 ? copy.maybe : copy.notRecommended;
  return `${rating}/5 — ${verdict}`;
}

function groupSessions(sessions) {
  const bySource = new Map();
  for (const session of sessions) {
    const key = sourceKey(session.manifest);
    if (!bySource.has(key)) bySource.set(key, { key, attempts: [], items: [] });
    bySource.get(key).attempts.push(session);
  }
  return [...bySource.values()].map((group) => {
    const successful = group.attempts.filter(({ manifest }) =>
      manifest.status !== "failed" && (manifest.items.length > 0 || ["complete", "partial"].includes(manifest.status)),
    );
    group.effective = successful.at(-1) || group.attempts.at(-1);
    group.failedAttempts = group.attempts.filter(({ manifest }) => manifest.status === "failed").length;
    group.rejected = group.attempts.reduce((total, { manifest }) => total + (manifest.rejectedFrames?.length || 0), 0);
    group.status = group.attempts.some(({ manifest }) => manifest.status === "complete")
      ? "complete"
      : group.attempts.some(({ manifest }) => manifest.status === "partial" || manifest.items.length > 0)
        ? "partial"
        : group.effective.manifest.status || "unknown";
    return group;
  });
}

export async function generateReport(rootValue, { title, language, maxRecommendations = 5 } = {}) {
  const root = await fs.realpath(path.resolve(rootValue));
  if (!Number.isInteger(maxRecommendations) || maxRecommendations < 0 || maxRecommendations > 100) {
    throw new Error("maxRecommendations must be an integer from 0 through 100.");
  }
  const manifestPaths = (await findManifestFiles(root)).sort();
  const sessions = [];

  for (const manifestPath of manifestPaths) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (!Array.isArray(manifest.items)) continue;
      sessions.push({ manifest, manifestPath, directory: path.dirname(manifestPath) });
    } catch {
      // A malformed or concurrently written manifest is omitted from the report.
    }
  }

  sessions.sort((left, right) => String(left.manifest.startedAt || "").localeCompare(String(right.manifest.startedAt || "")));
  const sources = groupSessions(sessions);
  const locale = String(language || sessions.find((session) => session.manifest.reportLanguage)?.manifest.reportLanguage || "en").toLowerCase().startsWith("es") ? "es" : "en";
  const copy = COPY[locale];
  const seenItems = new Set();
  const items = [];

  for (const source of sources) {
    for (const session of source.attempts) {
      for (const item of session.manifest.items) {
        const absolutePath = path.resolve(session.directory, item.path);
        if (!isWithin(root, absolutePath)) continue;
        const identity = item.sha256 ? `sha256:${item.sha256}` : `path:${absolutePath.toLowerCase()}`;
        if (seenItems.has(identity)) continue;
        seenItems.add(identity);
        const enriched = { ...item, session, source, absolutePath };
        source.items.push(enriched);
        items.push(enriched);
      }
    }
  }

  const rejected = sources.reduce((total, source) => total + source.rejected, 0);
  const recommended = items
    .filter(whatsappRecommended)
    .sort((left, right) => (right.whatsapp?.rating || 0) - (left.whatsapp?.rating || 0))
    .slice(0, maxRecommendations);
  const reportTitle = title || sessions.find((session) => session.manifest.collectionName)?.manifest.collectionName || path.basename(root);
  const lines = [
    `# ${markdownCell(reportTitle)}`,
    "",
    `${copy.generated}: ${new Date().toISOString()}`,
    "",
    `## ${copy.summary}`,
    "",
    `- ${copy.sourcesProcessed}: ${sources.length}`,
    `- ${copy.imagesCaptured}: ${items.length}`,
    `- ${copy.framesRejected}: ${rejected}`,
    `- ${copy.recommendations}: ${recommended.length}`,
    "",
  ];

  if (sources.length) {
    lines.push(
      `| ${copy.source} | ${copy.platform} | ${copy.status} | ${copy.attempts} | ${copy.captured} | ${copy.rejected} | ${copy.sessionSummary} |`,
      "| --- | --- | --- | ---: | ---: | ---: | --- |",
      ...sources.map((source) => {
        const manifest = source.effective.manifest;
        const attempts = source.failedAttempts
          ? `${source.attempts.length} (${source.failedAttempts} ${copy.failedAttempts})`
          : source.attempts.length;
        return `| ${markdownCell(sourceLabel(manifest))} | ${markdownCell(manifest.platform || "web")} | ${markdownCell(source.status)} | ${attempts} | ${source.items.length} | ${source.rejected} | ${markdownCell(manifest.summary || manifest.reason || manifest.error || "")} |`;
      }),
      "",
    );
  }

  lines.push(`## ${copy.capturedImages}`, "");
  if (!items.length) {
    lines.push(copy.noImages, "");
  } else {
    lines.push(
      `| # | ${copy.source} | ${copy.preview} | ${copy.file} | ${copy.description} | ${copy.whatsapp} |`,
      "| ---: | --- | --- | --- | --- | --- |",
    );
    items.forEach((item, index) => {
      const relativePath = markdownPath(root, item.absolutePath);
      const description = item.description || item.displayName || item.name || path.basename(item.path);
      lines.push(`| ${index + 1} | ${markdownCell(sourceLabel(item.source.effective.manifest))} | ![${markdownAlt(description)}](${relativePath}) | [${markdownCell(path.basename(item.path))}](${relativePath}) | ${markdownCell(description)} | ${markdownCell(whatsappLabel(item, copy))} |`);
    });
    lines.push("");
  }

  lines.push(`## ${copy.best}`, "");
  if (!recommended.length) {
    lines.push(copy.noRecommendations, "");
  } else {
    lines.push(
      `| ${copy.rating} | ${copy.image} | ${copy.why} |`,
      "| ---: | --- | --- |",
      ...recommended.map((item) => {
        const relativePath = markdownPath(root, item.absolutePath);
        return `| ${item.whatsapp.rating}/5 | [${markdownCell(item.displayName || item.name || path.basename(item.path))}](${relativePath}) | ${markdownCell(item.whatsapp.reason)} |`;
      }),
      "",
    );
  }

  lines.push(
    `## ${copy.notes}`,
    "",
    `- ${copy.note1}`,
    `- ${copy.note2}`,
    `- ${copy.note3}`,
    "",
  );

  const reportPath = path.join(root, "REPORT.md");
  await fs.writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  const knowledgeReports = await buildKnowledgeReports(root);
  return {
    reportPath,
    language: locale,
    sources: sources.length,
    attempts: sessions.length,
    captured: items.length,
    rejected,
    recommended: recommended.length,
    knowledgeReports,
  };
}
