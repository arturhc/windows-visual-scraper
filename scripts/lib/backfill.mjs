import fs from "node:fs/promises";
import path from "node:path";
import { findManifestFiles } from "./artifacts.mjs";
import { buildKnowledgeReports } from "./content-manifest.mjs";
import { createImageKnowledgeAsset, twinMarkdownPath } from "./knowledge-assets.mjs";

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function backfillImageKnowledge(rootValue, { force = false } = {}) {
  const root = await fs.realpath(path.resolve(rootValue));
  const result = { scanned: 0, created: 0, skipped: 0, errors: [] };
  for (const manifestPath of await findManifestFiles(root)) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); }
    catch (error) { result.errors.push({ manifestPath, error: error.message }); continue; }
    if (manifest.kind === "page-capture") continue;
    if (!Array.isArray(manifest.items)) continue;
    const runRoot = path.dirname(manifestPath);
    let changed = false;
    for (const item of manifest.items) {
      result.scanned += 1;
      const imagePath = path.resolve(runRoot, item.path);
      if (!isWithin(root, imagePath)) {
        result.errors.push({ imagePath, error: "Asset path escapes the collection root." });
        continue;
      }
      try {
        const markdownPath = twinMarkdownPath(imagePath);
        const exists = await fs.access(markdownPath).then(() => true).catch(() => false);
        if (exists && item.analysis?.path && !force) { result.skipped += 1; continue; }
        await createImageKnowledgeAsset({ imagePath, item, manifest, runRoot });
        result.created += 1;
        changed = true;
      } catch (error) {
        result.errors.push({ imagePath, error: error.message });
      }
    }
    if (changed) await writeJsonAtomic(manifestPath, manifest);
  }
  result.reports = await buildKnowledgeReports(root);
  return result;
}

export async function analyzeImageAsset({ rootValue, imagePath: imageValue, analysis }) {
  const root = await fs.realpath(path.resolve(rootValue));
  const imagePath = await fs.realpath(path.resolve(imageValue));
  if (!isWithin(root, imagePath)) throw new Error("Image must stay inside the collection root.");
  for (const manifestPath of await findManifestFiles(root)) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.items)) continue;
    const runRoot = path.dirname(manifestPath);
    const item = manifest.items.find((candidate) => path.resolve(runRoot, candidate.path) === imagePath);
    if (!item) continue;
    const result = await createImageKnowledgeAsset({ imagePath, item, manifest, runRoot, analysis });
    await writeJsonAtomic(manifestPath, manifest);
    const reports = await buildKnowledgeReports(root);
    return { status: "analyzed", manifestPath, imagePath, markdownPath: result.markdownPath, reports };
  }
  throw new Error("Image is not referenced by a source manifest under the collection root.");
}
