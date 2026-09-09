import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workflow dry-run resolves a plan without an API key", () => {
  const result = spawnSync(process.execPath, [
    "scripts/image-scraper.mjs", "run", "--preset", "generic-lightbox-gallery",
    "--url", "https://example.com/gallery", "--count", "2", "--dry-run"
  ], { cwd: root, encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "" } });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.plan.count, 2);
  assert.equal(output.plan.vision.apiKey, "missing");
});
