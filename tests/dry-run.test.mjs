import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("agent session dry-run resolves a plan without external model configuration", () => {
  const result = spawnSync(process.execPath, [
    "scripts/image-scraper.mjs", "start", "--preset", "generic-lightbox-gallery",
    "--url", "https://example.com/gallery", "--count", "2", "--dry-run"
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.plan.count, 2);
  assert.equal(output.plan.reasoningEngine, "host-agent");
  assert.equal("vision" in output.plan, false);
});
