import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);

export function slugify(value, fallback = "capture") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function findManifestFiles(directory, results = []) {
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
      await findManifestFiles(entryPath, results);
    } else if (entry.isFile() && entry.name === "manifest.json") {
      results.push(entryPath);
    }
  }
  return results;
}

export async function findDuplicateSha256(collectionRoot, sha256, { excludeManifestPath } = {}) {
  const excluded = excludeManifestPath ? path.resolve(excludeManifestPath) : null;
  for (const manifestPath of await findManifestFiles(path.resolve(collectionRoot))) {
    if (excluded && path.resolve(manifestPath) === excluded) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const item = Array.isArray(manifest.items)
        ? manifest.items.find((candidate) => candidate.sha256 === sha256)
        : null;
      if (item) return { manifestPath, item };
    } catch {
      // Ignore malformed or concurrently written manifests while checking duplicates.
    }
  }
  return null;
}

export async function createRunArtifacts(baseOutput, runName, initialManifest = {}) {
  const root = path.join(path.resolve(baseOutput), slugify(runName), timestampSlug());
  const directories = {
    root,
    screenshots: path.join(root, "screenshots"),
    media: path.join(root, "media"),
    trace: path.join(root, "trace"),
    raw: path.join(root, "raw"),
  };
  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));

  const manifestPath = path.join(root, "manifest.json");
  const tracePath = path.join(root, "run.ndjson");
  const manifest = {
    schemaVersion: 1,
    runName: slugify(runName),
    startedAt: new Date().toISOString(),
    status: "running",
    items: [],
    rejectedFrames: [],
    ...initialManifest,
  };

  async function writeManifest(patch = {}) {
    Object.assign(manifest, patch);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  async function log(event, data = {}) {
    const record = { at: new Date().toISOString(), event, ...data };
    await fs.appendFile(tracePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  await writeManifest();
  await log("run-created", { root });
  return { directories, manifest, manifestPath, tracePath, writeManifest, log };
}
