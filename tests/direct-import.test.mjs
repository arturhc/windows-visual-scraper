import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importDirectImage } from "../scripts/lib/direct-import.mjs";

test("direct import saves supported still images and rejects collection-wide duplicates", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "direct-import-test-"));
  try {
    const collectionRoot = path.join(temporary, "collection");
    const inputPath = path.join(temporary, "principal.png");
    await fs.writeFile(inputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
    const common = {
      rootValue: collectionRoot,
      inputPath,
      sourcePage: "https://example.com/about",
      collectionName: "Site references",
      targetLabel: "example-site",
      platform: "web",
      reportLanguage: "es",
      metadata: {
        name: "fachada principal luminosa",
        description: "Fachada principal del sitio con iluminación clara.",
        whatsappRating: 5,
        whatsappReason: "Se entiende de inmediato y presenta el lugar.",
      },
    };

    const first = await importDirectImage(common);
    const second = await importDirectImage({
      ...common,
      metadata: { ...common.metadata, name: "fachada repetida del sitio" },
    });
    assert.equal(first.status, "saved");
    assert.equal(second.status, "duplicate");
    assert.equal(second.report.sources, 1);
    assert.equal(second.report.attempts, 2);
    assert.equal(second.report.captured, 1);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
