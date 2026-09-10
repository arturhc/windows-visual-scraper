import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./artifacts.mjs";

async function runProcess(executable, args, { binary = false, maxBytes = 100 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill();
        fail(new Error(`Media tool output exceeded ${maxBytes} bytes.`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      const standardOutput = Buffer.concat(stdout);
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) return fail(new Error(`${path.basename(executable)} exited with code ${code}: ${errorOutput.trim()}`));
      settled = true;
      resolve({ stdout: binary ? standardOutput : standardOutput.toString("utf8"), stderr: errorOutput });
    });
  });
}

async function testExecutable(executable, versionArgument = "-version") {
  try {
    const result = await runProcess(executable, [versionArgument], { maxBytes: 2 * 1024 * 1024 });
    return { ok: true, path: executable, version: String(result.stdout || result.stderr).split(/\r?\n/)[0] };
  } catch (error) {
    return { ok: false, path: executable, error: error.message };
  }
}

export async function doctorMediaTools({ ffmpegPath = "ffmpeg", ffprobePath = "ffprobe", whisperPath = "whisper" } = {}) {
  const [ffmpeg, ffprobe, whisper] = await Promise.all([
    testExecutable(ffmpegPath),
    testExecutable(ffprobePath),
    testExecutable(whisperPath, "--help"),
  ]);
  return { ok: ffmpeg.ok && ffprobe.ok, ffmpeg, ffprobe, whisper };
}

export async function resolveMediaTools(options = {}) {
  const report = await doctorMediaTools(options);
  if (!report.ok) {
    throw new Error("Video analysis requires FFmpeg and FFprobe. Install FFmpeg for Windows or pass --ffmpeg-path and --ffprobe-path. Use doctor-video for diagnostics.");
  }
  return {
    ffmpeg: options.ffmpegPath || "ffmpeg",
    ffprobe: options.ffprobePath || "ffprobe",
    whisper: report.whisper.ok ? (options.whisperPath || "whisper") : null,
    report,
  };
}

function parseFraction(value) {
  const [numerator, denominator = "1"] = String(value || "0").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

export async function probeVideo(filePath, ffprobe) {
  const { stdout } = await runProcess(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels",
    "-of", "json",
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error("No video stream was found in the imported file.");
  return {
    duration: Number(data.format?.duration || 0),
    size: Number(data.format?.size || 0),
    format: data.format?.format_name || null,
    width: video.width || null,
    height: video.height || null,
    fps: Number((parseFraction(video.avg_frame_rate || video.r_frame_rate)).toFixed(3)),
    videoCodec: video.codec_name || null,
    audioPresent: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels || null,
  };
}

export function dHashFromGrayPixels(pixels) {
  if (!Buffer.isBuffer(pixels) || pixels.length < 72) throw new Error("dHash requires a 9x8 grayscale pixel buffer.");
  let value = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      value = (value << 1n) | (pixels[(row * 9) + column] > pixels[(row * 9) + column + 1] ? 1n : 0n);
    }
  }
  return value.toString(16).padStart(16, "0");
}

export function hammingDistanceHex(left, right) {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

export function colorDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 3 || right.length !== 3) return 0;
  return Math.sqrt(left.reduce((total, value, index) => total + ((value - right[index]) ** 2), 0));
}

export function deduplicateFrameRecords(records, threshold = 6) {
  const kept = [];
  const rejected = [];
  for (const record of records) {
    const duplicate = kept.find((candidate) =>
      candidate.sha256 === record.sha256
      || (hammingDistanceHex(candidate.perceptualHash, record.perceptualHash) <= threshold
        && colorDistance(candidate.meanColor, record.meanColor) <= 24),
    );
    if (duplicate) rejected.push({
      ...record,
      duplicateOf: duplicate.path,
      duplicateOfSha256: duplicate.sha256,
      reason: candidateReason(duplicate, record),
    });
    else kept.push(record);
  }
  return { kept, rejected };
}

function candidateReason(left, right) {
  return left.sha256 === right.sha256 ? "exact-duplicate" : "perceptual-duplicate";
}

export async function computeFrameDHash(framePath, ffmpeg) {
  const { stdout } = await runProcess(ffmpeg, [
    "-v", "error", "-i", framePath,
    "-vf", "scale=9:8:flags=area,format=gray",
    "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ], { binary: true, maxBytes: 1024 * 1024 });
  return dHashFromGrayPixels(stdout);
}

export async function computeFrameFingerprint(framePath, ffmpeg) {
  const { stdout } = await runProcess(ffmpeg, [
    "-v", "error", "-i", framePath,
    "-vf", "scale=9:8:flags=area,format=rgb24",
    "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ], { binary: true, maxBytes: 1024 * 1024 });
  if (stdout.length < 216) throw new Error("Could not read a 9x8 RGB fingerprint from keyframe.");
  const gray = Buffer.alloc(72);
  const totals = [0, 0, 0];
  for (let index = 0; index < 72; index += 1) {
    const red = stdout[index * 3];
    const green = stdout[(index * 3) + 1];
    const blue = stdout[(index * 3) + 2];
    totals[0] += red; totals[1] += green; totals[2] += blue;
    gray[index] = Math.round((red * 0.2126) + (green * 0.7152) + (blue * 0.0722));
  }
  return {
    perceptualHash: dHashFromGrayPixels(gray),
    meanColor: totals.map((value) => Math.round(value / 72)),
  };
}

export async function extractSceneCandidates(videoPath, outputDirectory, tools, config) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const maximum = config.keyframes.maxPerVideo;
  const pattern = path.join(outputDirectory, "candidate-%04d.jpg");
  const hard = config.sceneDetection.hardThreshold;
  const soft = config.sceneDetection.softThreshold;
  const gap = config.sceneDetection.meaningfulChangeGapSeconds;
  const filter = config.sceneDetection.enabled
    ? `select='eq(n\\,0)+gt(scene\\,${hard})+gte(t-prev_selected_t\\,${gap})*gt(scene\\,${soft})',showinfo`
    : "select='eq(n\\,0)',showinfo";
  const result = await runProcess(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "info", "-i", videoPath,
    "-vf", filter, "-fps_mode", "vfr", "-frames:v", String(maximum), "-q:v", "2", pattern,
  ]);
  const timestamps = [...result.stderr.matchAll(/pts_time:([\d.-]+)/g)].map((match) => Number(match[1]));
  const files = (await fs.readdir(outputDirectory))
    .filter((name) => /^candidate-\d+\.jpg$/i.test(name))
    .sort();
  const records = [];
  for (const [index, name] of files.entries()) {
    const framePath = path.join(outputDirectory, name);
    const fingerprint = await computeFrameFingerprint(framePath, tools.ffmpeg);
    records.push({
      path: framePath,
      timestamp: Number.isFinite(timestamps[index]) ? timestamps[index] : index === 0 ? 0 : null,
      sha256: await sha256File(framePath),
      ...fingerprint,
    });
  }
  if (!records.length) throw new Error("Scene detection did not produce any representative frames.");
  return config.keyframes.deduplicate
    ? deduplicateFrameRecords(records, config.keyframes.perceptualHammingThreshold)
    : { kept: records, rejected: [] };
}

export async function extractAudio(videoPath, outputPath, ffmpeg) {
  await runProcess(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-y", outputPath]);
  return outputPath;
}

export async function transcribeAudio(audioPath, outputDirectory, whisper) {
  if (!whisper) return { status: "missing_dependency", transcriptPath: null };
  await runProcess(whisper, [audioPath, "--output_dir", outputDirectory, "--output_format", "json"], { maxBytes: 20 * 1024 * 1024 });
  const transcriptPath = path.join(outputDirectory, `${path.basename(audioPath, path.extname(audioPath))}.json`);
  return { status: "complete", transcriptPath };
}
