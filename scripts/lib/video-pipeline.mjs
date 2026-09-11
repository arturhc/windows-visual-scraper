import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { baselineVideoAnalysis, normalizeVideoAnalysis, renderVideoAnalysisMarkdown } from "./analysis-contract.mjs";
import { sha256File, slugify } from "./artifacts.mjs";
import { buildKnowledgeReports } from "./content-manifest.mjs";
import { normalizeContentConfig } from "./content-config.mjs";
import { createImageKnowledgeAsset } from "./knowledge-assets.mjs";
import { extractAudio, extractSceneCandidates, probeVideo, resolveMediaTools, transcribeAudio } from "./media-tools.mjs";
import { resolveSourceAdapter } from "./source-adapters.mjs";

const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function findVideoMetadata(directory, results = []) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findVideoMetadata(entryPath, results);
    else if (entry.isFile() && entry.name === "metadata.json") results.push(entryPath);
  }
  return results;
}

async function existingVideoByHash(videosRoot, sha256) {
  for (const metadataPath of await findVideoMetadata(videosRoot)) {
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (metadata.kind === "content-intelligence-video" && metadata.contentHash === sha256 && metadata.status === "complete") {
        return { metadata, metadataPath };
      }
    } catch {}
  }
  return null;
}

async function countVideosForSource(videosRoot, source) {
  let count = 0;
  for (const metadataPath of await findVideoMetadata(videosRoot)) {
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      if (metadata.kind === "content-intelligence-video" && metadata.status === "complete"
        && metadata.source?.platform === source.platform
        && (metadata.source?.page || metadata.source?.account) === (source.page || source.account)) count += 1;
    } catch {}
  }
  return count;
}

function sourceExtension(value) {
  try {
    const extension = path.extname(new URL(value).pathname).toLowerCase();
    return VIDEO_EXTENSIONS.has(extension) ? extension : ".mp4";
  } catch {
    const extension = path.extname(value).toLowerCase();
    return VIDEO_EXTENSIONS.has(extension) ? extension : ".mp4";
  }
}

async function acquireVideo({ inputPath, videoUrl, destination, maxBytes }) {
  if ((inputPath ? 1 : 0) + (videoUrl ? 1 : 0) !== 1) throw new Error("Choose exactly one video source: --input or --url.");
  if (inputPath) {
    const resolved = await fs.realpath(path.resolve(inputPath));
    const stats = await fs.stat(resolved);
    if (stats.size > maxBytes) throw new Error(`Video exceeds video.maxDownloadBytes (${maxBytes} bytes).`);
    await fs.copyFile(resolved, destination);
    return { source: resolved, extension: sourceExtension(resolved) };
  }
  const response = await fetch(videoUrl, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Video download failed with HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error(`Video exceeds video.maxDownloadBytes (${maxBytes} bytes).`);
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`Video exceeds video.maxDownloadBytes (${maxBytes} bytes).`));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(destination, { flags: "wx" }));
  return { source: response.url || videoUrl, extension: sourceExtension(response.url || videoUrl) };
}

async function appendCollectionError(root, errorRecord) {
  const errorPath = path.join(root, "content-errors.ndjson");
  await fs.appendFile(errorPath, `${JSON.stringify({ at: new Date().toISOString(), ...errorRecord })}\n`, "utf8");
  return errorPath;
}

export async function recordVideoAcquisitionError({ rootValue, name, source, error, stage = "video-acquisition", retryable = true }) {
  const root = path.resolve(rootValue);
  await fs.mkdir(root, { recursive: true });
  const errorPath = await appendCollectionError(root, {
    asset: name || null,
    stage,
    error: error instanceof Error ? error.message : String(error),
    source: source || null,
    retryable,
  });
  return { errorPath, reports: await buildKnowledgeReports(root) };
}

async function uniqueVideoRoot(videosRoot, slug) {
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const name = suffix === 1 ? slug : `${slug}-${String(suffix).padStart(2, "0")}`;
    const candidate = path.join(videosRoot, name);
    try { await fs.access(candidate); } catch { return candidate; }
  }
  throw new Error("Could not allocate a unique semantic video directory.");
}

function videoAsset(metadata, root) {
  return {
    sourcePlatform: metadata.source.platform,
    sourceUrl: metadata.source.url,
    sourcePage: metadata.source.page,
    localFile: metadata.paths.original,
    capturedAt: metadata.capturedAt,
    duration: metadata.media.duration,
    width: metadata.media.width,
    height: metadata.media.height,
    fps: metadata.media.fps,
    videoCodec: metadata.media.videoCodec,
    audioPresent: metadata.media.audioPresent,
    audioCodec: metadata.media.audioCodec,
    contentHash: metadata.contentHash,
    root,
  };
}

export async function importAndProcessVideo({
  rootValue,
  inputPath,
  videoUrl,
  sourcePage,
  sourcePlatform,
  sourceAccount,
  name,
  config: configValue,
  analysis,
  ffmpegPath,
  ffprobePath,
  whisperPath,
  acquisitionMethod,
  acquisitionDetails,
}) {
  const root = path.resolve(rootValue);
  await fs.mkdir(root, { recursive: true });
  const config = normalizeContentConfig(configValue || { media: { images: true, videos: true } });
  if (!config.video.enabled) throw new Error("Video processing is disabled in content configuration.");
  const adapter = resolveSourceAdapter({ platform: sourcePlatform, url: sourcePage || videoUrl });
  const semanticName = String(name || "").trim();
  const slug = slugify(semanticName, "");
  if (!slug) throw new Error("--name must be a descriptive semantic video name.");
  const videosRoot = path.join(root, "assets", "videos");
  await fs.mkdir(videosRoot, { recursive: true });
  const incoming = path.join(videosRoot, `.incoming-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  let videoRoot;
  let metadataPath;
  let metadata;

  try {
    const acquired = await acquireVideo({ inputPath, videoUrl, destination: incoming, maxBytes: config.video.maxDownloadBytes });
    const contentHash = await sha256File(incoming);
    const existing = await existingVideoByHash(videosRoot, contentHash);
    if (existing) {
      await fs.rm(incoming, { force: true });
      return { status: "resumed", videoRoot: path.dirname(existing.metadataPath), metadataPath: existing.metadataPath, metadata: existing.metadata, reports: await buildKnowledgeReports(root) };
    }
    const source = {
      platform: adapter.platform,
      url: videoUrl || (acquisitionMethod ? sourcePage : acquired.source),
      page: sourcePage || videoUrl || null,
      account: sourceAccount || null,
      adapter: adapter.id,
    };
    const sourceCount = await countVideosForSource(videosRoot, source);
    if (sourceCount >= config.video.maxVideosPerSource) {
      await fs.rm(incoming, { force: true });
      throw new Error(`Source already reached video.maxVideosPerSource (${config.video.maxVideosPerSource}).`);
    }
    videoRoot = await uniqueVideoRoot(videosRoot, slug);
    await fs.mkdir(videoRoot, { recursive: true });
    const originalPath = path.join(videoRoot, `original${acquired.extension}`);
    await fs.rename(incoming, originalPath);
    metadataPath = path.join(videoRoot, "metadata.json");
    metadata = {
      schemaVersion: 1,
      kind: "content-intelligence-video",
      id: contentHash,
      slug: path.basename(videoRoot),
      name: semanticName,
      status: "processing",
      capturedAt: new Date().toISOString(),
      contentHash,
      source,
      acquisition: {
        method: acquisitionMethod || (inputPath ? "local-file" : "direct-video"),
        originalSource: acquisitionMethod ? (sourcePage || videoUrl || acquired.source) : acquired.source,
        ...(acquisitionDetails ? { details: acquisitionDetails } : {}),
      },
      config: config.video,
      media: null,
      scenes: [],
      keyframes: [],
      rejectedKeyframes: [],
      audio: { status: "not_started", path: null, transcriptStatus: "not_requested", transcriptPath: null },
      analysis: { status: "missing", path: portable(root, path.join(videoRoot, "video.md")) },
      paths: { root: portable(root, videoRoot), original: portable(root, originalPath), analysis: portable(root, path.join(videoRoot, "video.md")) },
      errors: [],
    };
    await writeJsonAtomic(metadataPath, metadata);

    const tools = await resolveMediaTools({ ffmpegPath, ffprobePath, whisperPath });
    metadata.tools = tools.report;
    metadata.media = await probeVideo(originalPath, tools.ffprobe);
    const workFrames = path.join(videoRoot, ".scene-candidates");
    const candidates = await extractSceneCandidates(originalPath, workFrames, tools, config.video);
    metadata.rejectedKeyframes = candidates.rejected.map((item) => ({
      timestamp: item.timestamp,
      sha256: item.sha256,
      perceptualHash: item.perceptualHash,
      reason: item.reason,
      duplicateOfSha256: item.duplicateOfSha256,
    }));

    for (const [index, candidate] of candidates.kept.entries()) {
      const sceneId = `scene-${String(index + 1).padStart(3, "0")}`;
      const nextTimestamp = candidates.kept[index + 1]?.timestamp;
      const startSeconds = Number(candidate.timestamp ?? (index === 0 ? 0 : metadata.scenes.at(-1)?.endSeconds || 0));
      const endSeconds = Number.isFinite(nextTimestamp) ? Number(nextTimestamp) : metadata.media.duration;
      const sceneRoot = path.join(videoRoot, "scenes", sceneId);
      await fs.mkdir(sceneRoot, { recursive: true });
      const keyframePath = path.join(sceneRoot, "keyframe-001.jpg");
      await fs.rename(candidate.path, keyframePath);
      const frameRole = index === 0 ? "scene-opening" : "representative";
      const item = {
        index: index + 1,
        path: portable(root, keyframePath),
        sha256: candidate.sha256,
        perceptualHash: candidate.perceptualHash,
        name: `${slug}-${sceneId}-keyframe`,
        displayName: `${semanticName} — ${sceneId}`,
        description: `Frame representativo de ${sceneId} a ${startSeconds.toFixed(3)} segundos; pendiente de análisis visual detallado.`,
        parentVideo: contentHash,
        scene: sceneId,
        timestamp: startSeconds,
        sceneStart: startSeconds,
        sceneEnd: endSeconds,
        frameRole,
        sourceUrl: source.url,
        sourcePage: source.page,
      };
      const keyframeAnalysis = analysis?.keyframes?.[sceneId];
      await createImageKnowledgeAsset({
        imagePath: keyframePath,
        item,
        manifest: { platform: source.platform, url: source.url, sourcePage: source.page, startedAt: metadata.capturedAt },
        runRoot: root,
        analysis: keyframeAnalysis,
      });
      metadata.keyframes.push({
        id: candidate.sha256,
        ...item,
        path: portable(root, keyframePath),
        analysis: item.analysis,
      });
      metadata.scenes.push({
        id: sceneId,
        startSeconds,
        endSeconds,
        duration: Math.max(0, endSeconds - startSeconds),
        boundaryType: index === 0 ? "video-opening" : "scene-cut-or-meaningful-visual-change",
        frameRole,
        keyframe: portable(root, keyframePath),
        keyframes: [candidate.sha256],
      });
    }
    await fs.rm(workFrames, { recursive: true, force: true });

    if (metadata.media.audioPresent && config.video.audio.extract) {
      const audioPath = path.join(videoRoot, "audio.wav");
      await extractAudio(originalPath, audioPath, tools.ffmpeg);
      metadata.audio = { status: "extracted", path: portable(root, audioPath), transcriptStatus: "not_requested", transcriptPath: null };
      if (config.video.audio.transcribe) {
        const transcription = await transcribeAudio(audioPath, videoRoot, tools.whisper);
        metadata.audio.transcriptStatus = transcription.status;
        metadata.audio.transcriptPath = transcription.transcriptPath ? portable(root, transcription.transcriptPath) : null;
        if (transcription.status === "missing_dependency") metadata.errors.push({
          asset: contentHash,
          stage: "transcription",
          error: "Whisper CLI was not found; video processing continued without transcription.",
          source: source.url,
          retryable: true,
        });
      }
    } else {
      metadata.audio.status = metadata.media.audioPresent ? "disabled" : "absent";
    }

    const providedVideoAnalysis = analysis?.video || (analysis && !analysis.keyframes ? analysis : null);
    const videoAnalysis = providedVideoAnalysis
      ? normalizeVideoAnalysis(providedVideoAnalysis)
      : baselineVideoAnalysis({ ...metadata.media, sceneCount: metadata.scenes.length });
    const videoMarkdownPath = path.join(videoRoot, "video.md");
    await fs.writeFile(videoMarkdownPath, renderVideoAnalysisMarkdown(videoAsset(metadata, root), videoAnalysis, metadata.scenes), "utf8");
    metadata.analysis = { status: videoAnalysis.status, confidence: videoAnalysis.confidence, path: portable(root, videoMarkdownPath), updatedAt: new Date().toISOString() };
    metadata.status = "complete";
    metadata.finishedAt = new Date().toISOString();
    await writeJsonAtomic(metadataPath, metadata);
    return { status: "complete", videoRoot, metadataPath, metadata, reports: await buildKnowledgeReports(root) };
  } catch (error) {
    await fs.rm(incoming, { force: true }).catch(() => {});
    if (metadata && metadataPath) {
      metadata.status = metadata.keyframes.length ? "partial" : "failed";
      metadata.finishedAt = new Date().toISOString();
      metadata.errors.push({ asset: metadata.id, stage: "video-processing", error: error.message, source: metadata.source?.url, retryable: true });
      await writeJsonAtomic(metadataPath, metadata).catch(() => {});
      await buildKnowledgeReports(root).catch(() => {});
    } else {
      await appendCollectionError(root, {
        asset: semanticName || null,
        stage: "video-acquisition",
        error: error.message,
        source: sourcePage || videoUrl || inputPath || null,
        retryable: true,
      }).catch(() => {});
      await buildKnowledgeReports(root).catch(() => {});
    }
    error.metadataPath = metadataPath;
    throw error;
  }
}

export async function analyzeVideoAsset({ rootValue, videoRoot: videoRootValue, analysis }) {
  const root = await fs.realpath(path.resolve(rootValue));
  const videoRoot = await fs.realpath(path.resolve(videoRootValue));
  const relative = path.relative(root, videoRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Video directory must stay inside the collection root.");
  const metadataPath = path.join(videoRoot, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (metadata.kind !== "content-intelligence-video") throw new Error("Unsupported video metadata file.");
  const normalized = normalizeVideoAnalysis(analysis.video || analysis);
  await fs.writeFile(path.join(videoRoot, "video.md"), renderVideoAnalysisMarkdown(videoAsset(metadata, root), normalized, metadata.scenes), "utf8");
  metadata.analysis = { status: "analyzed", confidence: normalized.confidence, path: metadata.paths.analysis, updatedAt: new Date().toISOString() };

  for (const keyframe of metadata.keyframes || []) {
    const frameAnalysis = analysis.keyframes?.[keyframe.scene];
    if (!frameAnalysis) continue;
    const imagePath = path.join(root, keyframe.path);
    await createImageKnowledgeAsset({
      imagePath,
      item: keyframe,
      manifest: { platform: metadata.source.platform, url: metadata.source.url, sourcePage: metadata.source.page, startedAt: metadata.capturedAt },
      runRoot: root,
      analysis: frameAnalysis,
    });
  }
  await writeJsonAtomic(metadataPath, metadata);
  return { status: "analyzed", metadataPath, videoMarkdownPath: path.join(videoRoot, "video.md"), reports: await buildKnowledgeReports(root) };
}
