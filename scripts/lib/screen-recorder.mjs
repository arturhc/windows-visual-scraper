import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function parsePixelCaptureBox(value) {
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error("--capture-box must be LEFT,TOP,WIDTH,HEIGHT in integer screen pixels.");
  }
  const [left, top, width, height] = parts;
  if (width < 16 || height < 16) throw new Error("--capture-box width and height must be at least 16 pixels.");
  if (width > 16384 || height > 16384) throw new Error("--capture-box exceeds the supported 16384-pixel dimension limit.");
  if (width % 2 || height % 2) throw new Error("--capture-box width and height must be even for H.264 compatibility.");
  return { left, top, width, height };
}

export function buildWindowsScreenCaptureArgs({
  outputPath,
  durationSeconds,
  frameRate = 30,
  captureBox,
  fullDesktop = false,
  drawMouse = false,
  audioDevice,
  maxBytes = 1073741824,
}) {
  if (!outputPath) throw new Error("A screen recording output path is required.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Screen recording duration must be positive.");
  if ((captureBox ? 1 : 0) + (fullDesktop ? 1 : 0) !== 1) {
    throw new Error("Choose exactly one screen capture area: --capture-box or --full-desktop.");
  }
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-f", "gdigrab",
    "-framerate", String(frameRate),
    "-draw_mouse", drawMouse ? "1" : "0",
  ];
  if (captureBox) {
    args.push(
      "-offset_x", String(captureBox.left),
      "-offset_y", String(captureBox.top),
      "-video_size", `${captureBox.width}x${captureBox.height}`,
    );
  }
  args.push("-i", "desktop");
  if (audioDevice) args.push("-f", "dshow", "-i", `audio=${audioDevice}`);
  args.push(
    "-t", String(durationSeconds),
    "-map", "0:v:0",
  );
  if (audioDevice) args.push("-map", "1:a:0", "-c:a", "aac", "-b:a", "160k");
  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-fs", String(maxBytes),
    "-y", outputPath,
  );
  return args;
}

async function runCapture(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    const stderr = [];
    let stderrBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 4 * 1024 * 1024) stderr.push(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return fail(new Error(`Visible screen recording failed with FFmpeg exit code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      settled = true;
      resolve();
    });
  });
}

export async function recordWindowsScreen({
  outputPath: outputValue,
  ffmpegPath = "ffmpeg",
  durationSeconds,
  frameRate = 30,
  captureBox,
  fullDesktop = false,
  drawMouse = false,
  audioDevice,
  countdownSeconds = 3,
  maxBytes = 1073741824,
}) {
  if (process.platform !== "win32") throw new Error("Visible screen recording is supported only on Windows.");
  const outputPath = path.resolve(outputValue);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = buildWindowsScreenCaptureArgs({
    outputPath,
    durationSeconds,
    frameRate,
    captureBox,
    fullDesktop,
    drawMouse,
    audioDevice,
    maxBytes,
  });
  if (countdownSeconds > 0) await delay(countdownSeconds * 1000);
  const startedAt = new Date().toISOString();
  await runCapture(ffmpegPath, args);
  const finishedAt = new Date().toISOString();
  const stats = await fs.stat(outputPath);
  if (!stats.size) throw new Error("Visible screen recording produced an empty file.");
  if (stats.size > maxBytes) {
    await fs.rm(outputPath, { force: true });
    throw new Error(`Visible screen recording exceeded the configured ${maxBytes}-byte limit.`);
  }
  return {
    outputPath,
    startedAt,
    finishedAt,
    bytes: stats.size,
    durationSeconds,
    frameRate,
    captureArea: captureBox ? { mode: "region", ...captureBox } : { mode: "full-desktop" },
    drawMouse,
    audio: audioDevice ? { requested: true, device: audioDevice } : { requested: false, device: null },
  };
}
