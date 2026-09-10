import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContentConfig } from "../scripts/lib/content-config.mjs";
import { listSourceAdapters, resolveSourceAdapter } from "../scripts/lib/source-adapters.mjs";

test("content configuration keeps images enabled and video disabled by default", () => {
  const config = normalizeContentConfig();
  assert.equal(config.media.images, true);
  assert.equal(config.media.videos, false);
  assert.equal(config.video.enabled, false);
  assert.equal(config.video.maxVideosPerSource, 10);
  assert.equal(config.video.maxDownloadBytes, 1073741824);
});

test("video limit and scene thresholds are configurable", () => {
  const config = normalizeContentConfig({
    media: { videos: true },
    video: { maxVideosPerSource: 4, maxDownloadBytes: 2097152, sceneDetection: { hardThreshold: 0.4, softThreshold: 0.12 } },
  });
  assert.equal(config.video.enabled, true);
  assert.equal(config.video.maxVideosPerSource, 4);
  assert.equal(config.video.maxDownloadBytes, 2097152);
  assert.equal(config.video.sceneDetection.hardThreshold, 0.4);
  assert.throws(() => normalizeContentConfig({ media: { images: false, videos: false } }), /At least one media type/);
});

test("source adapters separate acquisition from downstream analysis", () => {
  assert.deepEqual(listSourceAdapters().map((adapter) => adapter.id).sort(), ["facebook", "instagram", "website"]);
  assert.equal(resolveSourceAdapter({ url: "https://www.instagram.com/example/" }).id, "instagram");
  assert.equal(resolveSourceAdapter({ url: "https://example.com/about" }).id, "website");
});
