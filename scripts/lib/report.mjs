import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const COPY = {
  en: {
    generated: "Generated", summary: "Summary", sourcesProcessed: "Source sessions processed",
    imagesCaptured: "Images captured", framesRejected: "Frames rejected", recommendations: "WhatsApp recommendations",
    source: "Source", platform: "Platform", status: "Status", captured: "Captured", rejected: "Rejected", sessionSummary: "Session summary",
    capturedImages: "Captured images", noImages: "No images were captured.", preview: "Preview", file: "File", description: "Description", whatsapp: "WhatsApp",
    best: "Best options for a WhatsApp conversation", noRecommendations: "No image received a recommendation score of 4 or 5.", rating: "Rating", image: "Image", why: "Why it may work",
    notes: "Notes", note1: "Ratings are editorial suggestions based only on visible content, composition, clarity at phone size, and conversational usefulness.",
    note2: "Verify context, consent, and audience before sharing any captured image.", note3: "`manifest.json` files remain the machine-readable source of truth.",
    notRated: "Not rated", recommended: "Recommended", maybe: "Maybe", notRecommended: "Not recommended",
  },
  es: {
    generated: "Generado", summary: "Resumen", sourcesProcessed: "Sesiones de fuente procesadas",
    imagesCaptured: "Imágenes capturadas", framesRejected: "Capturas rechazadas", recommendations: "Recomendaciones para WhatsApp",
    source: "Fuente", platform: "Plataforma", status: "Estado", captured: "Capturadas", rejected: "Rechazadas", sessionSummary: "Resumen de la sesión",
    capturedImages: "Imágenes capturadas", noImages: "No se capturaron imágenes.", preview: "Vista previa", file: "Archivo", description: "Descripción", whatsapp: "WhatsApp",
    best: "Mejores opciones para una conversación de WhatsApp", noRecommendations: "Ninguna imagen recibió una calificación de 4 o 5.", rating: "Calificación", image: "Imagen", why: "Por qué podría funcionar",
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

async function findManifests(directory, results = []) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
      await findManifests(entryPath, results);
    } else if (entry.isFile() && entry.name === "manifest.json") {
      results.push(entryPath);
    }
  }
  return results;
}

function sourceLabel(manifest) {
  return manifest.targetLabel || manifest.workflow || manifest.runName || "capture";
}

function whatsappLabel(item, copy) {
  const rating = item.whatsapp?.rating;
  if (!Number.isInteger(rating)) return copy.notRated;
  const verdict = rating >= 4 ? copy.recommended : rating === 3 ? copy.maybe : copy.notRecommended;
  return `${rating}/5 — ${verdict}`;
}

export async function generateReport(rootValue, { title, language } = {}) {
  const root = await fs.realpath(path.resolve(rootValue));
  const manifestPaths = (await findManifests(root)).sort();
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
  const locale = String(language || sessions.find((session) => session.manifest.reportLanguage)?.manifest.reportLanguage || "en").toLowerCase().startsWith("es") ? "es" : "en";
  const copy = COPY[locale];
  const items = sessions.flatMap((session) => session.manifest.items
    .map((item) => ({ ...item, session, absolutePath: path.resolve(session.directory, item.path) }))
    .filter((item) => isWithin(root, item.absolutePath)));
  const rejected = sessions.reduce((total, session) => total + (session.manifest.rejectedFrames?.length || 0), 0);
  const recommended = items.filter((item) => (item.whatsapp?.rating || 0) >= 4);
  const reportTitle = title || sessions.find((session) => session.manifest.collectionName)?.manifest.collectionName || path.basename(root);
  const lines = [
    `# ${markdownCell(reportTitle)}`,
    "",
    `${copy.generated}: ${new Date().toISOString()}`,
    "",
    `## ${copy.summary}`,
    "",
    `- ${copy.sourcesProcessed}: ${sessions.length}`,
    `- ${copy.imagesCaptured}: ${items.length}`,
    `- ${copy.framesRejected}: ${rejected}`,
    `- ${copy.recommendations}: ${recommended.length}`,
    "",
  ];

  if (sessions.length) {
    lines.push(
      `| ${copy.source} | ${copy.platform} | ${copy.status} | ${copy.captured} | ${copy.rejected} | ${copy.sessionSummary} |`,
      "| --- | --- | --- | ---: | ---: | --- |",
      ...sessions.map(({ manifest }) => `| ${markdownCell(sourceLabel(manifest))} | ${markdownCell(manifest.platform || "web")} | ${markdownCell(manifest.status || "unknown")} | ${manifest.items.length} | ${manifest.rejectedFrames?.length || 0} | ${markdownCell(manifest.summary || manifest.reason || "")} |`),
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
      lines.push(`| ${index + 1} | ${markdownCell(sourceLabel(item.session.manifest))} | ![${markdownAlt(description)}](${relativePath}) | [${markdownCell(path.basename(item.path))}](${relativePath}) | ${markdownCell(description)} | ${markdownCell(whatsappLabel(item, copy))} |`);
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
      ...recommended
        .sort((left, right) => right.whatsapp.rating - left.whatsapp.rating)
        .map((item) => {
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
  return { reportPath, language: locale, sources: sessions.length, captured: items.length, rejected, recommended: recommended.length };
}
