import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateReport } from "../scripts/lib/report.mjs";

test("report generator builds a Markdown gallery and WhatsApp shortlist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "visual-report-test-"));
  try {
    const run = path.join(root, "instagram-example", "2026-09-09");
    const media = path.join(run, "media");
    await fs.mkdir(media, { recursive: true });
    await fs.writeFile(path.join(media, "001-sunset-toast.png"), "png-test");
    await fs.writeFile(path.join(run, "manifest.json"), JSON.stringify({
      runName: "instagram-example",
      collectionName: "Campaign references",
      targetLabel: "example",
      platform: "instagram",
      startedAt: "2026-09-09T00:00:00.000Z",
      status: "complete",
      summary: "Reviewed the profile gallery.",
      rejectedFrames: [{ reason: "video" }],
      items: [{
        index: 1,
        path: "media/001-sunset-toast.png",
        displayName: "Sunset toast",
        description: "Friends raise glasses during a warm sunset.",
        whatsapp: { rating: 5, recommended: true, reason: "Warm and conversational." },
      }],
    }, null, 2));

    const result = await generateReport(root, { language: "es" });
    const markdown = await fs.readFile(result.reportPath, "utf8");
    assert.equal(result.captured, 1);
    assert.equal(result.rejected, 1);
    assert.equal(result.recommended, 1);
    assert.match(markdown, /\| Fuente \| Plataforma \| Estado \|/);
    assert.match(markdown, /!\[Friends raise glasses during a warm sunset\.\]/);
    assert.match(markdown, /## Mejores opciones para una conversación de WhatsApp/);
    assert.match(markdown, /Warm and conversational/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
