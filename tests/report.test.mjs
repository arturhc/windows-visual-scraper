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

test("report groups retry attempts, deduplicates globally, respects flags, and limits recommendations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "visual-report-group-test-"));
  try {
    const writeRun = async (source, attempt, manifest) => {
      const run = path.join(root, source, attempt);
      await fs.mkdir(path.join(run, "media"), { recursive: true });
      for (const item of manifest.items) await fs.writeFile(path.join(run, item.path), item.sha256);
      await fs.writeFile(path.join(run, "manifest.json"), JSON.stringify(manifest));
    };
    const base = { collectionName: "References", targetLabel: "example", platform: "instagram", rejectedFrames: [] };
    await writeRun("instagram-example", "001", { ...base, startedAt: "2026-09-09T00:00:00.000Z", status: "failed", error: "capture failed", items: [] });
    await writeRun("instagram-example", "002", {
      ...base,
      startedAt: "2026-09-09T01:00:00.000Z",
      status: "complete",
      items: [
        { path: "media/a.png", sha256: "same", displayName: "A", description: "First clear image", whatsapp: { rating: 5, recommended: true, reason: "Best" } },
        { path: "media/b.png", sha256: "b", displayName: "B", description: "Explicitly omitted image", whatsapp: { rating: 5, recommended: false, reason: "Do not use" } },
        { path: "media/c.png", sha256: "c", displayName: "C", description: "Third clear image", whatsapp: { rating: 4, recommended: true, reason: "Good" } },
      ],
    });
    await writeRun("web-example", "001", {
      collectionName: "References",
      targetLabel: "site",
      platform: "web",
      startedAt: "2026-09-09T02:00:00.000Z",
      status: "complete",
      rejectedFrames: [],
      items: [
        { path: "media/duplicate.png", sha256: "same", displayName: "Duplicate", description: "Duplicate image", whatsapp: { rating: 5, recommended: true, reason: "Duplicate" } },
        { path: "media/d.png", sha256: "d", displayName: "D", description: "Fourth clear image", whatsapp: { rating: 5, recommended: true, reason: "Excellent" } },
      ],
    });

    const result = await generateReport(root, { language: "es", maxRecommendations: 2 });
    const markdown = await fs.readFile(result.reportPath, "utf8");
    assert.equal(result.sources, 2);
    assert.equal(result.attempts, 3);
    assert.equal(result.captured, 4);
    assert.equal(result.recommended, 2);
    assert.match(markdown, /2 \(1 fallidos\)/);
    const shortlist = markdown.split("## Mejores opciones")[1].split("## Notas")[0];
    assert.match(shortlist, /\[A\]/);
    assert.match(shortlist, /\[D\]/);
    assert.doesNotMatch(shortlist, /\[B\]/);
    assert.doesNotMatch(shortlist, /\[C\]/);
    assert.doesNotMatch(markdown, /\[Duplicate\]/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
