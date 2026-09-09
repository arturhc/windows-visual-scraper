import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRunArtifacts } from "../scripts/lib/artifacts.mjs";

test("run artifacts create an auditable manifest and NDJSON trace", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "visual-scraper-test-"));
  try {
    const artifacts = await createRunArtifacts(temporaryRoot, "Example Gallery", { url: "https://example.com" });
    await artifacts.log("verified", { value: 1 });
    await artifacts.writeManifest({ status: "complete", finishedAt: "test" });
    const manifest = JSON.parse(await fs.readFile(artifacts.manifestPath, "utf8"));
    const trace = await fs.readFile(artifacts.tracePath, "utf8");
    assert.equal(manifest.runName, "example-gallery");
    assert.equal(manifest.status, "complete");
    assert.match(trace, /"event":"verified"/);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
