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

test("content configuration accepts every supported media mode", () => {
  const imagesOnly = normalizeContentConfig({
    media: { images: true, videos: false },
    video: { enabled: false },
  });
  assert.deepEqual(imagesOnly.media, { images: true, videos: false });
  assert.equal(imagesOnly.video.enabled, false);

  const videosOnly = normalizeContentConfig({
    media: { images: false, videos: true },
  });
  assert.deepEqual(videosOnly.media, { images: false, videos: true });
  assert.equal(videosOnly.video.enabled, true);

  const imagesAndVideos = normalizeContentConfig({
    media: { images: true, videos: true },
  });
  assert.deepEqual(imagesAndVideos.media, { images: true, videos: true });
  assert.equal(imagesAndVideos.video.enabled, true);
});

test("content configuration rejects a run with every media type disabled", () => {
  assert.throws(
    () => normalizeContentConfig({ media: { images: false, videos: false } }),
    /At least one media type/,
  );
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
});

test("source adapters separate acquisition from downstream analysis", () => {
  assert.deepEqual(listSourceAdapters().map((adapter) => adapter.id).sort(), ["facebook", "instagram", "website"]);
  assert.equal(resolveSourceAdapter({ url: "https://www.instagram.com/example/" }).id, "instagram");
  assert.equal(resolveSourceAdapter({ url: "https://example.com/about" }).id, "website");
});
