import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSavedImageMetadata } from "./agent-session.mjs";
import { createRunArtifacts, findDuplicateSha256, sha256File } from "./artifacts.mjs";
import { generateReport } from "./report.mjs";
import { createImageKnowledgeAsset } from "./knowledge-assets.mjs";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PLATFORMS = new Set(["facebook", "instagram", "web"]);
const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

function detectImageExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  throw new Error("Only still PNG, JPEG, and WebP image files are supported for direct import.");
}

async function readImageBytes({ inputPath, imageUrl }) {
  if ((inputPath ? 1 : 0) + (imageUrl ? 1 : 0) !== 1) {
    throw new Error("Choose exactly one direct image source: --input or --url.");
  }
  if (inputPath) {
    const resolved = path.resolve(inputPath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile()) throw new Error(`Direct import input is not a file: ${resolved}`);
    if (stats.size > MAX_IMAGE_BYTES) throw new Error("Direct import image exceeds the 25 MB limit.");
    return { bytes: await fs.readFile(resolved), source: resolved };
  }

  const response = await fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("Direct import image exceeds the 25 MB limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Direct import image exceeds the 25 MB limit.");
  return { bytes, source: response.url || imageUrl };
}

export async function importDirectImage({
  rootValue,
  inputPath,
  imageUrl,
  sourcePage,
  collectionName,
  targetLabel,
  platform = "web",
  reportLanguage = "en",
  maxRecommendations = 5,
  metadata,
  analysis,
}) {
  const collectionRoot = path.resolve(rootValue);
  const resolvedPlatform = String(platform).toLowerCase();
  if (!PLATFORMS.has(resolvedPlatform)) throw new Error(`Unsupported platform: ${resolvedPlatform}.`);
  const resolvedTargetLabel = String(targetLabel || "").trim().slice(0, 120);
  if (!resolvedTargetLabel) throw new Error("--target-label is required for a direct import.");
  const resolvedCollectionName = String(collectionName || path.basename(collectionRoot)).trim().slice(0, 120) || "image-collection";
  const resolvedReportLanguage = String(reportLanguage).toLowerCase().startsWith("es") ? "es" : "en";
  const normalizedMetadata = normalizeSavedImageMetadata(metadata);
  const runName = `${resolvedPlatform}-${resolvedTargetLabel}`;
  const artifacts = await createRunArtifacts(collectionRoot, runName, {
    kind: "direct-import",
    sourcePage,
    requestedCount: 1,
    collectionName: resolvedCollectionName,
    targetLabel: resolvedTargetLabel,
    platform: resolvedPlatform,
    reportLanguage: resolvedReportLanguage,
  });

  try {
    const imported = await readImageBytes({ inputPath, imageUrl });
    const extension = detectImageExtension(imported.bytes);
    const candidatePath = path.join(artifacts.directories.raw, `imported-original${extension}`);
    await fs.writeFile(candidatePath, imported.bytes);
    const sha256 = await sha256File(candidatePath);
    const duplicate = await findDuplicateSha256(collectionRoot, sha256, { excludeManifestPath: artifacts.manifestPath });

    if (duplicate) {
      const duplicateOf = `${portable(collectionRoot, duplicate.manifestPath)}#${duplicate.item.path}`;
      artifacts.manifest.rejectedFrames.push({ reason: "duplicate", sha256, duplicateOf, source: imported.source });
      await fs.rm(candidatePath, { force: true });
      await artifacts.log("direct-import-rejected", { reason: "duplicate", sha256, duplicateOf });
      await artifacts.writeManifest({
        status: "complete",
        finishedAt: new Date().toISOString(),
        summary: "Direct image matched an existing collection item and was omitted.",
      });
      const report = await generateReport(collectionRoot, {
        title: resolvedCollectionName,
        language: resolvedReportLanguage,
        maxRecommendations,
      });
      return { status: "duplicate", manifestPath: artifacts.manifestPath, sha256, duplicateOf, report };
    }

    const finalPath = path.join(artifacts.directories.media, `001-${normalizedMetadata.fileStem}${extension}`);
    await fs.rename(candidatePath, finalPath);
    const item = {
      index: 1,
      path: portable(artifacts.directories.root, finalPath),
      sha256,
      cropSource: "direct-import",
      source: imported.source,
      sourcePage,
      name: normalizedMetadata.fileStem,
      displayName: normalizedMetadata.displayName,
      description: normalizedMetadata.description,
      tags: normalizedMetadata.tags,
      whatsapp: normalizedMetadata.whatsapp,
    };
    await createImageKnowledgeAsset({
      imagePath: finalPath,
      item,
      manifest: artifacts.manifest,
      runRoot: artifacts.directories.root,
      analysis,
    });
    artifacts.manifest.items.push(item);
    await artifacts.log("direct-image-imported", { path: finalPath, sha256, source: imported.source });
    await artifacts.writeManifest({
      status: "complete",
      finishedAt: new Date().toISOString(),
      summary: "Imported one principal still image directly from a non-gallery web source.",
    });
    const report = await generateReport(collectionRoot, {
      title: resolvedCollectionName,
      language: resolvedReportLanguage,
      maxRecommendations,
    });
    return {
      status: "saved",
      collectionRoot,
      manifestPath: artifacts.manifestPath,
      imagePath: finalPath,
      sha256,
      report,
    };
  } catch (error) {
    await artifacts.log("direct-import-error", { message: error.message, stack: error.stack });
    await artifacts.writeManifest({ status: "failed", finishedAt: new Date().toISOString(), error: error.message });
    error.manifestPath = artifacts.manifestPath;
    throw error;
  }
}
