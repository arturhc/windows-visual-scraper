#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertEdgeProfile,
  assertHttpUrl,
  assertLiveUiAuthorized,
  parseCli,
  readBoolean,
  readInteger,
  readNumber,
  requireOption,
  resolveOutputDir,
} from "./lib/args.mjs";
import {
  actAgentSession,
  deriveTargetLabel,
  finishAgentSession,
  inferPlatform,
  parseCropBox,
  parseRatioPair,
  rejectAgentFrame,
  saveAgentFrame,
  shotAgentSession,
  startAgentSession,
  statusAgentSession,
} from "./lib/agent-session.mjs";
import { analyzeImageAsset, backfillImageKnowledge } from "./lib/backfill.mjs";
import { closeBrowserSession, openBrowserSession } from "./lib/browser-session.mjs";
import { buildKnowledgeReports } from "./lib/content-manifest.mjs";
import { loadContentConfig, writeContentConfig } from "./lib/content-config.mjs";
import { importDirectImage } from "./lib/direct-import.mjs";
import { doctorMediaTools } from "./lib/media-tools.mjs";
import { generateReport } from "./lib/report.mjs";
import { capturePage } from "./lib/runner.mjs";
import { helperPath, windowsBrowser } from "./lib/windows-bridge.mjs";
import { listPresets, loadWorkflow, validateWorkflow } from "./lib/workflow-schema.mjs";
import { listSourceAdapters } from "./lib/source-adapters.mjs";
import { parsePixelCaptureBox, recordWindowsScreen } from "./lib/screen-recorder.mjs";
import { analyzeVideoAsset, importAndProcessVideo, recordVideoAcquisitionError } from "./lib/video-pipeline.mjs";

const HELP = `Windows Visual Image Scraper

Codex or another image-capable code agent is the visual reasoning engine.
The bundled scripts do not call an AI API and do not require a separate API key.

Commands:
  doctor [--capture-test --confirm-live-ui]
  list-presets
  validate-workflow --all | --workflow PATH
  init-config --output PATH
  validate-config [--config PATH]
  list-source-adapters
  doctor-video [--ffmpeg-path PATH] [--ffprobe-path PATH] [--whisper-path PATH]
  capture-page --url URL [--shots N] [--dry-run | --confirm-live-ui]
  start (--preset NAME | --workflow PATH) --url URL [--count N] [--collection NAME] [--target-label NAME] [--report-language en|es] [--dry-run | --confirm-live-ui]
  shot --session PATH [--context STAGE_ID|collection] [--label TEXT]
  act --session PATH --context STAGE_ID|collection (--click X,Y | --key KEY | --wait-ms N | --done)
  save --session PATH --input PNG (--crop-box L,T,R,B | --heuristic | --full-window) --name TEXT --description TEXT --whatsapp-rating 1-5 --whatsapp-reason TEXT [--analysis-file JSON]
  reject --session PATH --input PNG --reason TEXT [--media-type TEXT]
  status --session PATH
  finish --session PATH [--status complete|partial|failed] [--summary TEXT] [--reason TEXT]
  import-image --root PATH (--input IMAGE | --url IMAGE_URL) --source-page URL --target-label TEXT --name TEXT --description TEXT --whatsapp-rating 1-5 --whatsapp-reason TEXT [--analysis-file JSON]
  analyze-image --root PATH --image PATH --analysis-file JSON
  backfill --root PATH [--force]
  import-video --root PATH (--input VIDEO | --url VIDEO_URL) --source-page URL --name TEXT [--config PATH] [--analysis-file JSON] [--ffmpeg-path PATH] [--ffprobe-path PATH]
  capture-video --root PATH --source-page URL --name TEXT --duration-seconds N (--capture-box LEFT,TOP,WIDTH,HEIGHT | --full-desktop) [--audio-device NAME] [--dry-run | --confirm-live-ui]
  analyze-video --root PATH --video-root PATH --analysis-file JSON
  index --root PATH
  report --root PATH [--title TEXT] [--language en|es] [--max-recommendations N]

Use --dry-run before any live UI run. See references/cli.md for all options.`;

function print(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(value, label = "JSON file") {
  if (!value) return undefined;
  try {
    return JSON.parse(await fs.readFile(path.resolve(value), "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
}

function runtimeOptions(options, workflow) {
  return {
    profile: assertEdgeProfile(typeof options.profile === "string" ? options.profile : "Default"),
    launchWaitMs: readInteger(options["launch-wait-ms"], workflow?.browser?.launchWaitMs ?? 4_000, { min: 0, max: 60_000 }),
    waitMs: readInteger(options["wait-ms"], 1_200, { min: 0, max: 60_000 }),
    pauseForLogin: readBoolean(options["pause-for-login"]),
    fullscreen: readBoolean(options.fullscreen, workflow?.browser?.fullscreen ?? true),
    resetScroll: readBoolean(options["reset-scroll"], true),
    keepOpen: readBoolean(options["keep-open"]),
    trace: readBoolean(options.trace, true),
  };
}

function assertWindows() {
  if (process.platform !== "win32") throw new Error("Live browser control is supported only on Windows.");
}

async function doctor(options = {}) {
  const captureRequested = readBoolean(options["capture-test"]);
  if (captureRequested) assertLiveUiAuthorized(options);
  const report = {
    platform: process.platform,
    node: process.version,
    helperPath,
    helperReadable: false,
    agentNative: true,
    aiApiRequired: false,
    windowsRuntime: null,
    captureTest: captureRequested ? { ok: false, attempted: false } : { requested: false },
  };
  try { await fs.access(helperPath); report.helperReadable = true; } catch {}
  if (process.platform === "win32" && report.helperReadable) {
    try { report.windowsRuntime = await windowsBrowser.doctor(); }
    catch (error) { report.windowsRuntime = { ok: false, error: error.message }; }
  }
  report.ok = report.platform === "win32" && report.helperReadable && !report.windowsRuntime?.error;
  if (captureRequested && report.ok) {
    assertWindows();
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "visual-image-scraper-doctor-"));
    let browserSession;
    try {
      browserSession = await openBrowserSession("about:blank", {
        profile: assertEdgeProfile(typeof options.profile === "string" ? options.profile : "Default"),
        launchWaitMs: readInteger(options["launch-wait-ms"], 1_500, { min: 0, max: 60_000 }),
        fullscreen: false,
      });
      const screenshotPath = path.join(temporaryRoot, "capture-test.png");
      await windowsBrowser.screenshot(browserSession.target, screenshotPath);
      const stats = await fs.stat(screenshotPath);
      if (stats.size === 0) throw new Error("Capture smoke test produced an empty PNG.");
      report.captureTest = { ok: true, attempted: true, bytes: stats.size };
    } catch (error) {
      report.captureTest = { ok: false, attempted: true, error: error.message };
      report.ok = false;
    } finally {
      await closeBrowserSession(browserSession, { keepOpen: false });
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }
  print(report);
  if (!report.ok) process.exitCode = 1;
}

async function validateCommand(options) {
  if (readBoolean(options.all)) {
    const presets = await listPresets();
    print({ valid: true, count: presets.length, workflows: presets.map((preset) => preset.name) });
    return;
  }
  const workflowPath = requireOption(options, "workflow");
  const raw = JSON.parse(await fs.readFile(workflowPath, "utf8"));
  validateWorkflow(raw);
  print({ valid: true, workflow: raw.name });
}

async function initConfigCommand(options) {
  print(await writeContentConfig(requireOption(options, "output")));
}

async function validateConfigCommand(options) {
  const config = await loadContentConfig(typeof options.config === "string" ? options.config : undefined);
  print({ valid: true, config });
}

async function doctorVideoCommand(options) {
  const report = await doctorMediaTools({
    ffmpegPath: typeof options["ffmpeg-path"] === "string" ? options["ffmpeg-path"] : undefined,
    ffprobePath: typeof options["ffprobe-path"] === "string" ? options["ffprobe-path"] : undefined,
    whisperPath: typeof options["whisper-path"] === "string" ? options["whisper-path"] : undefined,
  });
  print(report);
  if (!report.ok) process.exitCode = 1;
}

async function captureCommand(options) {
  const url = assertHttpUrl(requireOption(options, "url"));
  const shots = readInteger(options.shots, 1, { min: 1, max: 50 });
  const stepPages = readInteger(options["step-pages"], 1, { min: 0, max: 20 });
  const plan = { command: "capture-page", url, shots, stepPages, outputDir: resolveOutputDir(options), options: runtimeOptions(options) };
  if (readBoolean(options["dry-run"])) return print({ dryRun: true, plan });
  assertLiveUiAuthorized(options);
  assertWindows();
  const result = await capturePage(plan);
  print({ status: result.manifest.status, captured: result.manifest.items.length, manifestPath: result.manifestPath });
}

async function startCommand(options) {
  const preset = typeof options.preset === "string" ? options.preset : undefined;
  const workflowPath = typeof options.workflow === "string" ? options.workflow : undefined;
  const loaded = await loadWorkflow({ preset, workflowPath });
  const url = assertHttpUrl(requireOption(options, "url"));
  const count = readInteger(options.count, loaded.workflow.collection.defaultCount, { min: 1, max: 100 });
  const collectionName = typeof options.collection === "string" ? options.collection.trim() : "social-image-collection";
  const targetLabel = typeof options["target-label"] === "string" ? options["target-label"].trim() : deriveTargetLabel(url);
  const platform = typeof options.platform === "string" ? options.platform.trim().toLowerCase() : inferPlatform(url);
  const reportLanguage = typeof options["report-language"] === "string" ? options["report-language"].trim() : "en";
  const maxRecommendations = readInteger(options["max-recommendations"], 5, { min: 0, max: 100 });
  const plan = {
    command: "start",
    workflow: loaded.workflow.name,
    workflowPath: loaded.path,
    url,
    count: Math.min(count, loaded.workflow.collection.maxCount),
    collectionName,
    targetLabel,
    platform,
    reportLanguage,
    maxRecommendations,
    outputDir: resolveOutputDir(options),
    options: runtimeOptions(options, loaded.workflow),
    reasoningEngine: "host-agent",
  };
  if (readBoolean(options["dry-run"])) return print({ dryRun: true, plan });
  assertLiveUiAuthorized(options);
  assertWindows();
  print(await startAgentSession({ ...plan, workflow: loaded.workflow }));
}

function sessionValue(options) {
  return requireOption(options, "session");
}

function parseAction(options) {
  const choices = [
    typeof options.click === "string" ? "click" : null,
    typeof options.key === "string" ? "key" : null,
    options["wait-ms"] != null ? "wait" : null,
    readBoolean(options.done) ? "done" : null,
  ].filter(Boolean);
  if (choices.length !== 1) throw new Error("Choose exactly one action: --click, --key, --wait-ms, or --done.");
  if (choices[0] === "click") return { type: "click", ...parseRatioPair(options.click, "--click") };
  if (choices[0] === "key") return { type: "key", key: String(options.key).toUpperCase() };
  if (choices[0] === "wait") return { type: "wait", waitMs: readInteger(options["wait-ms"], 0, { min: 0, max: 60_000 }) };
  return { type: "done" };
}

async function shotCommand(options) {
  assertWindows();
  print(await shotAgentSession({
    sessionValue: sessionValue(options),
    label: typeof options.label === "string" ? options.label : "frame",
    context: typeof options.context === "string" ? options.context : undefined,
  }));
}

async function actCommand(options) {
  assertWindows();
  print(await actAgentSession({
    sessionValue: sessionValue(options),
    context: requireOption(options, "context"),
    action: parseAction(options),
  }));
}

async function saveCommand(options) {
  assertWindows();
  const choices = [
    typeof options["crop-box"] === "string" ? "agent" : null,
    readBoolean(options.heuristic) ? "heuristic" : null,
    readBoolean(options["full-window"]) ? "full-window" : null,
  ].filter(Boolean);
  if (choices.length !== 1) throw new Error("Choose exactly one save method: --crop-box, --heuristic, or --full-window.");
  print(await saveAgentFrame({
    sessionValue: sessionValue(options),
    inputPath: requireOption(options, "input"),
    method: choices[0],
    cropBox: choices[0] === "agent" ? parseCropBox(options["crop-box"]) : undefined,
    metadata: {
      name: requireOption(options, "name"),
      description: requireOption(options, "description"),
      whatsappRating: requireOption(options, "whatsapp-rating"),
      whatsappReason: requireOption(options, "whatsapp-reason"),
      tags: typeof options.tags === "string" ? options.tags.split(",") : [],
    },
    analysis: await readJsonFile(typeof options["analysis-file"] === "string" ? options["analysis-file"] : undefined, "Image analysis file"),
  }));
}

async function rejectCommand(options) {
  print(await rejectAgentFrame({
    sessionValue: sessionValue(options),
    inputPath: requireOption(options, "input"),
    reason: requireOption(options, "reason"),
    mediaType: typeof options["media-type"] === "string" ? options["media-type"] : undefined,
  }));
}

async function finishCommand(options) {
  assertWindows();
  print(await finishAgentSession({
    sessionValue: sessionValue(options),
    status: typeof options.status === "string" ? options.status : "complete",
    reason: typeof options.reason === "string" ? options.reason : undefined,
    summary: typeof options.summary === "string" ? options.summary : undefined,
  }));
}

async function reportCommand(options) {
  const root = requireOption(options, "root");
  const title = typeof options.title === "string" ? options.title : undefined;
  const language = typeof options.language === "string" ? options.language : undefined;
  const maxRecommendations = readInteger(options["max-recommendations"], 5, { min: 0, max: 100 });
  print(await generateReport(root, { title, language, maxRecommendations }));
}

async function importImageCommand(options) {
  const inputPath = typeof options.input === "string" ? options.input : undefined;
  const imageUrl = typeof options.url === "string" ? assertHttpUrl(options.url) : undefined;
  const sourcePage = typeof options["source-page"] === "string"
    ? assertHttpUrl(options["source-page"])
    : imageUrl;
  if (!sourcePage) throw new Error("--source-page is required when importing a local image file.");
  print(await importDirectImage({
    rootValue: requireOption(options, "root"),
    inputPath,
    imageUrl,
    sourcePage,
    collectionName: typeof options.collection === "string" ? options.collection : undefined,
    targetLabel: requireOption(options, "target-label"),
    platform: typeof options.platform === "string" ? options.platform : "web",
    reportLanguage: typeof options["report-language"] === "string" ? options["report-language"] : "en",
    maxRecommendations: readInteger(options["max-recommendations"], 5, { min: 0, max: 100 }),
    metadata: {
      name: requireOption(options, "name"),
      description: requireOption(options, "description"),
      whatsappRating: requireOption(options, "whatsapp-rating"),
      whatsappReason: requireOption(options, "whatsapp-reason"),
      tags: typeof options.tags === "string" ? options.tags.split(",") : [],
    },
    analysis: await readJsonFile(typeof options["analysis-file"] === "string" ? options["analysis-file"] : undefined, "Image analysis file"),
  }));
}

async function analyzeImageCommand(options) {
  print(await analyzeImageAsset({
    rootValue: requireOption(options, "root"),
    imagePath: requireOption(options, "image"),
    analysis: await readJsonFile(requireOption(options, "analysis-file"), "Image analysis file"),
  }));
}

async function backfillCommand(options) {
  print(await backfillImageKnowledge(requireOption(options, "root"), { force: readBoolean(options.force) }));
}

async function importVideoCommand(options) {
  const videoUrl = typeof options.url === "string" ? assertHttpUrl(options.url) : undefined;
  const inputPath = typeof options.input === "string" ? options.input : undefined;
  const sourcePage = typeof options["source-page"] === "string" ? assertHttpUrl(options["source-page"]) : videoUrl;
  if (inputPath && !sourcePage) throw new Error("Provide --source-page for local video provenance.");
  const configFile = typeof options.config === "string" ? options.config : undefined;
  const override = {
    media: { videos: true },
    video: {
      enabled: true,
      ...(options["max-videos-per-source"] != null ? { maxVideosPerSource: readInteger(options["max-videos-per-source"], 10, { min: 1, max: 100 }) } : {}),
      ...(options["max-download-bytes"] != null ? { maxDownloadBytes: readInteger(options["max-download-bytes"], 1073741824, { min: 1048576, max: 10737418240 }) } : {}),
      sceneDetection: {
        ...((options["hard-scene-threshold"] ?? options["scene-threshold"]) != null ? { hardThreshold: readNumber(options["hard-scene-threshold"] ?? options["scene-threshold"], 0.32, { min: 0.01, max: 1 }) } : {}),
        ...(options["soft-scene-threshold"] != null ? { softThreshold: readNumber(options["soft-scene-threshold"], 0.08, { min: 0, max: 1 }) } : {}),
        ...(options["meaningful-change-gap-seconds"] != null ? { meaningfulChangeGapSeconds: readNumber(options["meaningful-change-gap-seconds"], 8, { min: 1, max: 300 }) } : {}),
      },
      keyframes: {
        ...(options["max-keyframes"] != null ? { maxPerVideo: readInteger(options["max-keyframes"], 200, { min: 1, max: 1000 }) } : {}),
        ...(options["perceptual-hamming-threshold"] != null ? { perceptualHammingThreshold: readInteger(options["perceptual-hamming-threshold"], 6, { min: 0, max: 64 }) } : {}),
      },
      audio: {
        ...(options["no-audio"] != null ? { extract: !readBoolean(options["no-audio"], false) } : {}),
        ...(options.transcribe != null ? { transcribe: readBoolean(options.transcribe, false) } : {}),
      },
    },
  };
  const config = await loadContentConfig(configFile, override);
  print(await importAndProcessVideo({
    rootValue: requireOption(options, "root"),
    inputPath,
    videoUrl,
    sourcePage,
    sourcePlatform: typeof options.platform === "string" ? options.platform : undefined,
    sourceAccount: typeof options["source-account"] === "string" ? options["source-account"] : undefined,
    name: requireOption(options, "name"),
    config,
    analysis: await readJsonFile(typeof options["analysis-file"] === "string" ? options["analysis-file"] : undefined, "Video analysis file"),
    ffmpegPath: typeof options["ffmpeg-path"] === "string" ? options["ffmpeg-path"] : undefined,
    ffprobePath: typeof options["ffprobe-path"] === "string" ? options["ffprobe-path"] : undefined,
    whisperPath: typeof options["whisper-path"] === "string" ? options["whisper-path"] : undefined,
  }));
}

async function captureVideoCommand(options) {
  const sourcePage = assertHttpUrl(requireOption(options, "source-page"));
  const captureBox = typeof options["capture-box"] === "string" ? parsePixelCaptureBox(options["capture-box"]) : undefined;
  const fullDesktop = readBoolean(options["full-desktop"]);
  if ((captureBox ? 1 : 0) + (fullDesktop ? 1 : 0) !== 1) {
    throw new Error("Choose exactly one screen capture area: --capture-box or --full-desktop.");
  }
  const durationSeconds = readNumber(requireOption(options, "duration-seconds"), 0, { min: 1, max: 7200 });
  const frameRate = readInteger(options.framerate, 30, { min: 1, max: 60 });
  const countdownSeconds = readInteger(options["countdown-seconds"], 3, { min: 0, max: 30 });
  const configFile = typeof options.config === "string" ? options.config : undefined;
  const override = {
    media: { videos: true },
    video: {
      enabled: true,
      ...(options["max-videos-per-source"] != null ? { maxVideosPerSource: readInteger(options["max-videos-per-source"], 10, { min: 1, max: 100 }) } : {}),
      ...(options["max-download-bytes"] != null ? { maxDownloadBytes: readInteger(options["max-download-bytes"], 1073741824, { min: 1048576, max: 10737418240 }) } : {}),
    },
  };
  const config = await loadContentConfig(configFile, override);
  const plan = {
    command: "capture-video",
    sourcePage,
    name: requireOption(options, "name"),
    durationSeconds,
    frameRate,
    countdownSeconds,
    captureArea: captureBox ? { mode: "region", ...captureBox } : { mode: "full-desktop" },
    drawMouse: readBoolean(options["draw-mouse"]),
    audioDevice: typeof options["audio-device"] === "string" ? options["audio-device"] : null,
    maxBytes: config.video.maxDownloadBytes,
  };
  if (readBoolean(options["dry-run"])) return print({ dryRun: true, plan });
  assertLiveUiAuthorized(options);
  assertWindows();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "visual-video-capture-"));
  const recordingPath = path.join(temporaryRoot, "capture.mp4");
  try {
    let capture;
    try {
      capture = await recordWindowsScreen({
        outputPath: recordingPath,
        ffmpegPath: typeof options["ffmpeg-path"] === "string" ? options["ffmpeg-path"] : "ffmpeg",
        durationSeconds,
        frameRate,
        captureBox,
        fullDesktop,
        drawMouse: plan.drawMouse,
        audioDevice: plan.audioDevice || undefined,
        countdownSeconds,
        maxBytes: config.video.maxDownloadBytes,
      });
    } catch (error) {
      await recordVideoAcquisitionError({
        rootValue: requireOption(options, "root"),
        name: plan.name,
        source: sourcePage,
        error,
        stage: "visible-screen-recording",
      });
      throw error;
    }
    const captureDetails = { ...capture };
    delete captureDetails.outputPath;
    print(await importAndProcessVideo({
      rootValue: requireOption(options, "root"),
      inputPath: recordingPath,
      sourcePage,
      sourcePlatform: typeof options.platform === "string" ? options.platform : undefined,
      sourceAccount: typeof options["source-account"] === "string" ? options["source-account"] : undefined,
      name: plan.name,
      config,
      analysis: await readJsonFile(typeof options["analysis-file"] === "string" ? options["analysis-file"] : undefined, "Video analysis file"),
      ffmpegPath: typeof options["ffmpeg-path"] === "string" ? options["ffmpeg-path"] : undefined,
      ffprobePath: typeof options["ffprobe-path"] === "string" ? options["ffprobe-path"] : undefined,
      whisperPath: typeof options["whisper-path"] === "string" ? options["whisper-path"] : undefined,
      acquisitionMethod: "visible-screen-recording",
      acquisitionDetails: captureDetails,
    }));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function analyzeVideoCommand(options) {
  print(await analyzeVideoAsset({
    rootValue: requireOption(options, "root"),
    videoRoot: requireOption(options, "video-root"),
    analysis: await readJsonFile(requireOption(options, "analysis-file"), "Video analysis file"),
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === "help" || command === "--help" || command === "-h") return print(HELP);
  if (command === "doctor") return doctor(options);
  if (command === "list-presets") return print(await listPresets());
  if (command === "validate-workflow") return validateCommand(options);
  if (command === "init-config") return initConfigCommand(options);
  if (command === "validate-config") return validateConfigCommand(options);
  if (command === "list-source-adapters") return print(listSourceAdapters());
  if (command === "doctor-video") return doctorVideoCommand(options);
  if (command === "capture-page") return captureCommand(options);
  if (command === "start" || command === "run") return startCommand(options);
  if (command === "shot") return shotCommand(options);
  if (command === "act") return actCommand(options);
  if (command === "save") return saveCommand(options);
  if (command === "reject") return rejectCommand(options);
  if (command === "status") return print(await statusAgentSession(sessionValue(options)));
  if (command === "finish") return finishCommand(options);
  if (command === "import-image") return importImageCommand(options);
  if (command === "analyze-image") return analyzeImageCommand(options);
  if (command === "backfill") return backfillCommand(options);
  if (command === "import-video") return importVideoCommand(options);
  if (command === "capture-video") return captureVideoCommand(options);
  if (command === "analyze-video") return analyzeVideoCommand(options);
  if (command === "index") return print(await buildKnowledgeReports(requireOption(options, "root")));
  if (command === "report") return reportCommand(options);
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.manifestPath) process.stderr.write(`Manifest: ${error.manifestPath}\n`);
    process.exitCode = 1;
  });
}
