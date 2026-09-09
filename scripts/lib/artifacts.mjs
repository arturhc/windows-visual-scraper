import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
