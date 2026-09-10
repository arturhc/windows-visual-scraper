import fs from "node:fs/promises";
import path from "node:path";
import { findManifestFiles } from "./artifacts.mjs";

const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>").trim();
}

function markdownLink(root, target, label) {
  if (!target) return "—";
  const relative = portable(root, target).split("/").map(encodeURIComponent).join("/");
  return `[${markdownCell(label || path.basename(target))}](${relative})`;
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function findNamedFiles(directory, fileName, results = []) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findNamedFiles(entryPath, fileName, results);
    else if (entry.isFile() && entry.name === fileName) results.push(entryPath);
  }
  return results;
}

export async function collectKnowledgeInventory(rootValue) {
  const root = await fs.realpath(path.resolve(rootValue));
  const images = [];
  const videos = [];
  const errors = [];
  const duplicates = [];
  const discarded = [];
  const sources = new Map();
  const seenHashes = new Set();

  try {
    const errorLog = await fs.readFile(path.join(root, "content-errors.ndjson"), "utf8");
    for (const line of errorLog.split(/\r?\n/).filter(Boolean)) {
      try { errors.push(JSON.parse(line)); }
      catch (error) { errors.push({ asset: "content-errors.ndjson", stage: "error-log-read", error: error.message, source: null, retryable: true }); }
    }
  } catch (error) {
    if (error.code !== "ENOENT") errors.push({ asset: "content-errors.ndjson", stage: "error-log-read", error: error.message, source: null, retryable: true });
  }

  for (const manifestPath of await findManifestFiles(root)) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const manifestDirectory = path.dirname(manifestPath);
      const sourceKey = `${manifest.platform || "web"}\u0000${manifest.targetLabel || manifest.runName || "source"}`;
      if (!sources.has(sourceKey)) sources.set(sourceKey, {
        platform: manifest.platform || "web",
        label: manifest.targetLabel || manifest.runName || "source",
        urls: [...new Set([manifest.url, manifest.sourcePage].filter(Boolean))],
      });
      for (const rejected of manifest.rejectedFrames || []) {
        discarded.push({ manifest: portable(root, manifestPath), source: manifest.url || manifest.sourcePage || null, ...rejected });
        if (rejected.reason === "duplicate") duplicates.push({ manifest: portable(root, manifestPath), ...rejected });
      }
      if (manifest.status === "failed") errors.push({
        asset: null,
        stage: "acquisition",
        error: manifest.error || manifest.reason || "Source attempt failed.",
        source: manifest.url || manifest.sourcePage || sourceKey,
        retryable: true,
      });
      for (const item of manifest.kind === "page-capture" ? [] : (manifest.items || [])) {
        const localPath = path.resolve(manifestDirectory, item.path);
        if (item.sha256 && seenHashes.has(item.sha256)) continue;
        if (item.sha256) seenHashes.add(item.sha256);
        images.push({
          id: item.sha256 || `image-${images.length + 1}`,
          type: item.parentVideo ? "video_keyframe" : "image",
          source: {
            platform: manifest.platform || "web",
            url: item.sourceUrl || item.source || manifest.url || manifest.sourcePage || null,
            page: item.sourcePage || manifest.sourcePage || manifest.url || null,
            account: manifest.targetLabel || null,
          },
          title: item.displayName || item.name || path.basename(item.path),
          description: item.description || "",
          paths: {
            media: portable(root, localPath),
            analysis: item.analysis?.path ? portable(root, path.resolve(manifestDirectory, item.analysis.path)) : null,
            sourceManifest: portable(root, manifestPath),
          },
          dimensions: { width: item.width || null, height: item.height || null, aspectRatio: item.aspectRatio || null },
          hash: item.sha256 || null,
          capturedAt: item.capturedAt || manifest.finishedAt || manifest.startedAt || null,
          analysis: item.analysis || { status: "missing" },
          parent: item.parentVideo || null,
          scene: item.scene || null,
          timestamp: item.timestamp ?? null,
        });
      }
    } catch (error) {
      errors.push({ asset: portable(root, manifestPath), stage: "manifest-read", error: error.message, source: null, retryable: true });
    }
  }

  for (const metadataPath of await findNamedFiles(path.join(root, "assets", "videos"), "metadata.json")) {
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (metadata.kind !== "content-intelligence-video") continue;
      videos.push({ ...metadata, paths: { ...metadata.paths, metadata: portable(root, metadataPath) } });
      for (const rejected of metadata.rejectedKeyframes || []) {
        const record = { manifest: portable(root, metadataPath), source: metadata.source?.url || metadata.source?.page || null, stage: "keyframe-deduplication", ...rejected };
        discarded.push(record);
        duplicates.push(record);
      }
      for (const keyframe of metadata.keyframes || []) {
        if (keyframe.sha256 && seenHashes.has(keyframe.sha256)) continue;
        if (keyframe.sha256) seenHashes.add(keyframe.sha256);
        images.push({
          id: keyframe.sha256 || keyframe.id,
          type: "video_keyframe",
          source: metadata.source,
          title: keyframe.displayName || keyframe.name,
          description: keyframe.description || "",
          paths: {
            media: keyframe.path,
            analysis: keyframe.analysis?.path || null,
            sourceManifest: portable(root, metadataPath),
          },
          dimensions: { width: keyframe.width || null, height: keyframe.height || null, aspectRatio: keyframe.aspectRatio || null },
          hash: keyframe.sha256 || null,
          capturedAt: metadata.capturedAt,
          analysis: keyframe.analysis || { status: "missing" },
          parent: metadata.id,
          scene: keyframe.scene,
          timestamp: keyframe.timestamp,
        });
      }
      const sourceKey = `${metadata.source?.platform || "web"}\u0000${metadata.source?.page || metadata.source?.url || metadata.slug}`;
      if (!sources.has(sourceKey)) sources.set(sourceKey, {
        platform: metadata.source?.platform || "web",
        label: metadata.source?.account || metadata.slug,
        urls: [...new Set([metadata.source?.url, metadata.source?.page].filter(Boolean))],
      });
      for (const error of metadata.errors || []) errors.push(error);
    } catch (error) {
      errors.push({ asset: portable(root, metadataPath), stage: "video-metadata-read", error: error.message, source: null, retryable: true });
    }
  }

  return { root, sources: [...sources.values()], images, videos, duplicates, discarded, errors };
}

export async function buildKnowledgeReports(rootValue) {
  const inventory = await collectKnowledgeInventory(rootValue);
  const { root, sources, images, videos, duplicates, discarded, errors } = inventory;
  const reportsRoot = path.join(root, "reports");
  await fs.mkdir(reportsRoot, { recursive: true });
  const analyzedImages = images.filter((item) => item.analysis?.status === "analyzed").length;
  const basicImages = images.filter((item) => item.analysis?.status === "basic").length;
  const analyzedVideos = videos.filter((item) => item.analysis?.status === "analyzed").length;
  const sceneCount = videos.reduce((total, video) => total + (video.scenes?.length || 0), 0);
  const keyframeCount = videos.reduce((total, video) => total + (video.keyframes?.length || 0), 0);
  const analysisTotal = images.length + videos.length;
  const analyzedTotal = analyzedImages + analyzedVideos;
  const coverage = analysisTotal ? Number(((analyzedTotal / analysisTotal) * 100).toFixed(1)) : 0;
  const generatedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    kind: "content-intelligence-manifest",
    generatedAt,
    sources,
    assets: { images, videos },
    relationships: videos.flatMap((video) => (video.scenes || []).map((scene) => ({
      parent: video.id,
      scene: scene.id,
      keyframes: scene.keyframes || [scene.keyframe].filter(Boolean),
    }))),
    duplicates,
    discarded,
    errors,
    summary: {
      sources: sources.length,
      images: images.length,
      imagesAnalyzed: analyzedImages,
      imagesBasic: basicImages,
      videos: videos.length,
      videosAnalyzed: analyzedVideos,
      scenes: sceneCount,
      keyframes: keyframeCount,
      duplicates: duplicates.length,
      discarded: discarded.length,
      errors: errors.length,
      analysisCoveragePercent: coverage,
    },
  };
  const manifestPath = path.join(root, "content-manifest.json");
  await writeJsonAtomic(manifestPath, manifest);

  const imageLines = [
    "# Índice de imágenes",
    "",
    `Generado: ${generatedAt}`,
    "",
    `Encontradas: ${images.length + discarded.length} · Conservadas/descargadas: ${images.length} · Descartadas: ${discarded.length} · Analizadas: ${analyzedImages} · Análisis básico: ${basicImages} · Duplicados: ${duplicates.length}`,
    "",
    "| # | Imagen | Descripción | Fuente | URL original | Archivo | Análisis | Dimensiones | Estado |",
    "| ---: | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...images.map((item, index) => {
      const media = path.join(root, item.paths.media);
      const analysis = item.paths.analysis ? path.join(root, item.paths.analysis) : null;
      const original = item.source.url ? `[origen](${encodeURI(String(item.source.url)).replaceAll("(", "%28").replaceAll(")", "%29")})` : "—";
      return `| ${index + 1} | ${markdownCell(item.title)} | ${markdownCell(item.description)} | ${markdownCell(item.source.platform)} | ${original} | ${markdownLink(reportsRoot, media)} | ${markdownLink(reportsRoot, analysis)} | ${item.dimensions.width || "?"}×${item.dimensions.height || "?"} | ${markdownCell(item.analysis?.status || "missing")} |`;
    }),
    "",
    "## Descartes",
    "",
    ...(discarded.length ? discarded.map((item) => `- ${markdownCell(item.reason || item.stage || "descartada")}: ${markdownCell(item.source || item.manifest || "fuente desconocida")}`) : ["Sin descartes registrados."]),
    "",
    "## Errores",
    "",
    ...(errors.length ? errors.map((item) => `- ${markdownCell(item.stage)}: ${markdownCell(item.error)}`) : ["Sin errores registrados."]),
    "",
  ];
  const imagesIndexPath = path.join(reportsRoot, "images-index.md");
  await fs.writeFile(imagesIndexPath, `${imageLines.join("\n")}\n`, "utf8");

  const videoLines = [
    "# Índice de videos",
    "",
    `Generado: ${generatedAt}`,
    "",
    `Videos conservados: ${videos.length} · Analizados: ${analyzedVideos} · Escenas: ${sceneCount} · Keyframes: ${keyframeCount}`,
    "",
    "| # | Video | Fuente | Original | Análisis | Duración | Escenas | Estado |",
    "| ---: | --- | --- | --- | --- | ---: | ---: | --- |",
    ...videos.map((video, index) => `| ${index + 1} | ${markdownCell(video.name || video.slug)} | ${markdownCell(video.source?.platform || "web")} | ${markdownLink(reportsRoot, path.join(root, video.paths.original))} | ${markdownLink(reportsRoot, path.join(root, video.paths.analysis))} | ${Number(video.media?.duration || 0).toFixed(2)}s | ${video.scenes?.length || 0} | ${markdownCell(video.status)} |`),
    "",
  ];
  const videosIndexPath = path.join(reportsRoot, "videos-index.md");
  await fs.writeFile(videosIndexPath, `${videoLines.join("\n")}\n`, "utf8");

  const runLines = [
    "# Reporte general de ejecución",
    "",
    `Generado: ${generatedAt}`,
    "",
    "## Resumen",
    "",
    `- Fuentes procesadas: ${sources.length}`,
    `- Imágenes encontradas/conservadas: ${images.length}`,
    `- Imágenes analizadas: ${analyzedImages}`,
    `- Imágenes con análisis básico pendiente de profundización: ${basicImages}`,
    `- Videos descargados: ${videos.length}`,
    `- Videos analizados: ${analyzedVideos}`,
    `- Escenas detectadas: ${sceneCount}`,
    `- Keyframes generados: ${keyframeCount}`,
    `- Duplicados: ${duplicates.length}`,
    `- Activos descartados: ${discarded.length}`,
    `- Errores: ${errors.length}`,
    `- Cobertura de análisis profundo: ${coverage}%`,
    "",
    "## Fuentes",
    "",
    ...sources.map((source) => `- ${source.platform}: ${source.label}${source.urls.length ? ` — ${source.urls.join(", ")}` : ""}`),
    "",
    "## Navegación",
    "",
    `- ${markdownLink(reportsRoot, imagesIndexPath, "Índice de imágenes")}`,
    `- ${markdownLink(reportsRoot, videosIndexPath, "Índice de videos")}`,
    `- ${markdownLink(reportsRoot, manifestPath, "Manifiesto machine-readable")}`,
    "",
    "## Errores",
    "",
    ...(errors.length ? errors.map((error) => `- ${error.stage}: ${error.error} (retryable: ${error.retryable !== false})`) : ["Sin errores registrados."]),
    "",
  ];
  const runReportPath = path.join(reportsRoot, "run-report.md");
  await fs.writeFile(runReportPath, `${runLines.join("\n")}\n`, "utf8");
  return { manifestPath, imagesIndexPath, videosIndexPath, runReportPath, summary: manifest.summary };
}
