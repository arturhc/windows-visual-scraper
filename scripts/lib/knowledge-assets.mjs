import fs from "node:fs/promises";
import path from "node:path";
import { baselineImageAnalysis, normalizeImageAnalysis, renderImageAnalysisMarkdown } from "./analysis-contract.mjs";
import { readImageMetadata } from "./image-metadata.mjs";

const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

export function twinMarkdownPath(imagePath) {
  return path.join(path.dirname(imagePath), `${path.basename(imagePath, path.extname(imagePath))}.md`);
}

export async function createImageKnowledgeAsset({ imagePath, item, manifest, runRoot, analysis }) {
  const image = await readImageMetadata(imagePath);
  const markdownPath = twinMarkdownPath(imagePath);
  const normalized = analysis
    ? normalizeImageAnalysis(analysis)
    : baselineImageAnalysis(item.description || item.displayName || item.name);
  const asset = {
    assetType: item.parentVideo ? "video_keyframe" : "image",
    sourcePlatform: manifest.platform || "web",
    sourceUrl: item.sourceUrl || item.source || manifest.url || manifest.sourcePage || null,
    sourcePage: item.sourcePage || manifest.sourcePage || manifest.url || null,
    localFile: portable(runRoot, imagePath),
    capturedAt: item.capturedAt || manifest.finishedAt || manifest.startedAt || new Date().toISOString(),
    contentHash: item.sha256,
    width: image.width,
    height: image.height,
    aspectRatio: image.aspectRatio,
    parentVideo: item.parentVideo,
    scene: item.scene,
    timestamp: item.timestamp,
    sceneStart: item.sceneStart,
    sceneEnd: item.sceneEnd,
    frameRole: item.frameRole,
  };
  await fs.writeFile(markdownPath, renderImageAnalysisMarkdown(asset, normalized), "utf8");
  item.width = image.width;
  item.height = image.height;
  item.aspectRatio = image.aspectRatio;
  item.analysis = {
    schemaVersion: 1,
    status: normalized.status,
    confidence: normalized.confidence,
    path: portable(runRoot, markdownPath),
    updatedAt: new Date().toISOString(),
  };
  return { item, markdownPath, analysis: normalized };
}
