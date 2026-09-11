import assert from "node:assert/strict";
import test from "node:test";
import { buildWindowsScreenCaptureArgs, parsePixelCaptureBox } from "../scripts/lib/screen-recorder.mjs";

test("parsePixelCaptureBox accepts a Windows pixel region", () => {
  assert.deepEqual(parsePixelCaptureBox("120, 80, 1280, 720"), { left: 120, top: 80, width: 1280, height: 720 });
});

test("parsePixelCaptureBox rejects invalid or tiny regions", () => {
  assert.throws(() => parsePixelCaptureBox("0,0,10,10"), /at least 16 pixels/);
  assert.throws(() => parsePixelCaptureBox("0,0,1279,720"), /must be even/);
  assert.throws(() => parsePixelCaptureBox("0,0,1280"), /LEFT,TOP,WIDTH,HEIGHT/);
});

test("screen capture args target a region without audio by default", () => {
  const args = buildWindowsScreenCaptureArgs({
    outputPath: "C:\\capture\\video.mp4",
    durationSeconds: 45,
    frameRate: 30,
    captureBox: { left: 100, top: 50, width: 1280, height: 720 },
    maxBytes: 500000000,
  });
  assert.deepEqual(args.slice(0, 17), [
    "-hide_banner", "-loglevel", "error",
    "-f", "gdigrab",
    "-framerate", "30",
    "-draw_mouse", "0",
    "-offset_x", "100",
    "-offset_y", "50",
    "-video_size", "1280x720",
    "-i", "desktop",
  ]);
  assert.equal(args.includes("dshow"), false);
  assert.equal(args.at(-1), "C:\\capture\\video.mp4");
  assert.equal(args[args.indexOf("-fs") + 1], "500000000");
});

test("screen capture args can include one authorized Windows audio device", () => {
  const args = buildWindowsScreenCaptureArgs({
    outputPath: "capture.mp4",
    durationSeconds: 10,
    fullDesktop: true,
    audioDevice: "Stereo Mix (Realtek Audio)",
  });
  assert.equal(args.includes("dshow"), true);
  assert.equal(args.includes("audio=Stereo Mix (Realtek Audio)"), true);
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-c:v")), [
    "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k",
  ]);
});

test("screen capture requires an explicit region or full desktop", () => {
  assert.throws(() => buildWindowsScreenCaptureArgs({
    outputPath: "capture.mp4",
    durationSeconds: 10,
  }), /exactly one screen capture area/);
});
