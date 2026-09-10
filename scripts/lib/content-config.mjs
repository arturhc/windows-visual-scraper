import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONTENT_CONFIG = Object.freeze({
  schemaVersion: 1,
  sources: {
    website: null,
    instagram: null,
    facebook: null,
    other: [],
    discoverSources: false,
  },
  media: { images: true, videos: false },
  video: {
    enabled: false,
    maxVideosPerSource: 10,
    maxDownloadBytes: 1073741824,
    sceneDetection: {
      enabled: true,
      hardThreshold: 0.32,
      softThreshold: 0.08,
      meaningfulChangeGapSeconds: 8,
    },
    keyframes: {
      deduplicate: true,
      perceptualHammingThreshold: 6,
      maxPerVideo: 200,
    },
    audio: { extract: true, transcribe: false },
  },
  analysis: {
    imageDescriptions: true,
    videoDescriptions: true,
    generationGuidance: true,
  },
  output: { root: "content-intelligence" },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeObject(base, patch) {
  const result = clone(base);
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = mergeObject(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
}

function assertNumber(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? "an integer" : "a number"} from ${min} through ${max}.`);
  }
}

export function normalizeContentConfig(input = {}) {
  const config = mergeObject(DEFAULT_CONTENT_CONFIG, input);
  if (config.schemaVersion !== 1) throw new Error("content config schemaVersion must be 1.");
  for (const key of ["images", "videos"]) assertBoolean(config.media[key], `media.${key}`);
  if (!config.media.images && !config.media.videos) throw new Error("At least one media type must be enabled.");
  config.video.enabled = config.media.videos || config.video.enabled === true;
  if (config.video.enabled) config.media.videos = true;
  assertNumber(config.video.maxVideosPerSource, "video.maxVideosPerSource", 1, 100, true);
  assertNumber(config.video.maxDownloadBytes, "video.maxDownloadBytes", 1048576, 10737418240, true);
  assertBoolean(config.video.sceneDetection.enabled, "video.sceneDetection.enabled");
  assertNumber(config.video.sceneDetection.hardThreshold, "video.sceneDetection.hardThreshold", 0.01, 1);
  assertNumber(config.video.sceneDetection.softThreshold, "video.sceneDetection.softThreshold", 0, config.video.sceneDetection.hardThreshold);
  assertNumber(config.video.sceneDetection.meaningfulChangeGapSeconds, "video.sceneDetection.meaningfulChangeGapSeconds", 1, 300);
  assertBoolean(config.video.keyframes.deduplicate, "video.keyframes.deduplicate");
  assertNumber(config.video.keyframes.perceptualHammingThreshold, "video.keyframes.perceptualHammingThreshold", 0, 64, true);
  assertNumber(config.video.keyframes.maxPerVideo, "video.keyframes.maxPerVideo", 1, 1000, true);
  assertBoolean(config.video.audio.extract, "video.audio.extract");
  assertBoolean(config.video.audio.transcribe, "video.audio.transcribe");
  for (const key of ["imageDescriptions", "videoDescriptions", "generationGuidance"]) {
    assertBoolean(config.analysis[key], `analysis.${key}`);
  }
  if (!Array.isArray(config.sources.other)) throw new Error("sources.other must be an array.");
  for (const key of ["website", "instagram", "facebook"]) {
    if (config.sources[key] != null && typeof config.sources[key] !== "string") {
      throw new Error(`sources.${key} must be a URL string or null.`);
    }
  }
  config.output.root = path.normalize(String(config.output.root || "content-intelligence"));
  return config;
}

export async function loadContentConfig(filePath, overrides = {}) {
  const fileConfig = filePath
    ? JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"))
    : {};
  return normalizeContentConfig(mergeObject(fileConfig, overrides));
}

export async function writeContentConfig(filePath, config = {}) {
  const normalized = normalizeContentConfig(config);
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { path: resolved, config: normalized };
}
