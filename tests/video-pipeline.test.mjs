import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeContentConfig } from "../scripts/lib/content-config.mjs";
import { doctorMediaTools } from "../scripts/lib/media-tools.mjs";
import { importAndProcessVideo } from "../scripts/lib/video-pipeline.mjs";

test("video acquisition limits size and persists an early structured error", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-limit-test-"));
  try {
    const input = path.join(root, "oversized.mp4");
    await fs.writeFile(input, Buffer.alloc(1048577));
    const collection = path.join(root, "collection");
    const config = normalizeContentConfig({ media: { videos: true }, video: { maxDownloadBytes: 1048576 } });
    await assert.rejects(importAndProcessVideo({
      rootValue: collection,
      inputPath: input,
      sourcePage: "https://example.com/videos",
      sourcePlatform: "web",
      name: "video demasiado grande",
      config,
    }), /maxDownloadBytes/);
    const errors = (await fs.readFile(path.join(collection, "content-errors.ndjson"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(errors[0].stage, "video-acquisition");
    const manifest = JSON.parse(await fs.readFile(path.join(collection, "content-manifest.json"), "utf8"));
    assert.equal(manifest.errors[0].stage, "video-acquisition");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("video pipeline probes media, detects visual segments, writes keyframe twins, and resumes by hash", async (context) => {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
  const tools = await doctorMediaTools({ ffmpegPath, ffprobePath });
  if (!tools.ok) return context.skip("FFmpeg/FFprobe are not installed on this machine.");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-pipeline-test-"));
  try {
    const input = path.join(root, "source.mp4");
    const generated = spawnSync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:d=1:r=10",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1:r=10",
      "-f", "lavfi", "-i", "color=c=green:s=160x90:d=1:r=10",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[outv]",
      "-map", "[outv]", "-pix_fmt", "yuv420p", "-y", input,
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const collection = path.join(root, "collection");
    const config = normalizeContentConfig({ media: { videos: true }, video: { sceneDetection: { hardThreshold: 0.2, softThreshold: 0.04, meaningfulChangeGapSeconds: 1 } } });
    const first = await importAndProcessVideo({
      rootValue: collection,
      inputPath: input,
      sourcePage: "https://example.com/videos",
      sourcePlatform: "web",
      name: "transiciones de color primario",
      config,
      ffmpegPath,
      ffprobePath,
      acquisitionMethod: "visible-screen-recording",
      acquisitionDetails: { captureArea: { mode: "region", left: 0, top: 0, width: 160, height: 90 } },
    });
    assert.equal(first.status, "complete");
    assert.equal(first.metadata.media.width, 160);
    assert.equal(first.metadata.source.url, "https://example.com/videos");
    assert.equal(first.metadata.acquisition.method, "visible-screen-recording");
    assert.ok(first.metadata.scenes.length >= 2);
    await fs.access(path.join(first.videoRoot, "video.md"));
    await fs.access(path.join(first.videoRoot, "scenes", "scene-001", "keyframe-001.md"));
    const second = await importAndProcessVideo({
      rootValue: collection,
      inputPath: input,
      sourcePage: "https://example.com/videos",
      sourcePlatform: "web",
      name: "transiciones repetidas",
      config,
      ffmpegPath,
      ffprobePath,
    });
    assert.equal(second.status, "resumed");
    const manifest = JSON.parse(await fs.readFile(path.join(collection, "content-manifest.json"), "utf8"));
    assert.equal(manifest.assets.videos.length, 1);
    assert.ok(manifest.relationships.length >= 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
