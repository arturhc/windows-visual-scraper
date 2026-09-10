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
import { closeBrowserSession, openBrowserSession } from "./lib/browser-session.mjs";
import { importDirectImage } from "./lib/direct-import.mjs";
import { generateReport } from "./lib/report.mjs";
import { capturePage } from "./lib/runner.mjs";
import { helperPath, windowsBrowser } from "./lib/windows-bridge.mjs";
import { listPresets, loadWorkflow, validateWorkflow } from "./lib/workflow-schema.mjs";

const HELP = `Windows Visual Image Scraper

Codex or another image-capable code agent is the visual reasoning engine.
The bundled scripts do not call an AI API and do not require a separate API key.

Commands:
  doctor [--capture-test --confirm-live-ui]
  list-presets
  validate-workflow --all | --workflow PATH
  capture-page --url URL [--shots N] [--dry-run | --confirm-live-ui]
  start (--preset NAME | --workflow PATH) --url URL [--count N] [--collection NAME] [--target-label NAME] [--report-language en|es] [--dry-run | --confirm-live-ui]
  shot --session PATH [--context STAGE_ID|collection] [--label TEXT]
  act --session PATH --context STAGE_ID|collection (--click X,Y | --key KEY | --wait-ms N | --done)
  save --session PATH --input PNG (--crop-box L,T,R,B | --heuristic | --full-window) --name TEXT --description TEXT --whatsapp-rating 1-5 --whatsapp-reason TEXT
  reject --session PATH --input PNG --reason TEXT [--media-type TEXT]
  status --session PATH
  finish --session PATH [--status complete|partial|failed] [--summary TEXT] [--reason TEXT]
  import-image --root PATH (--input IMAGE | --url IMAGE_URL) --source-page URL --target-label TEXT --name TEXT --description TEXT --whatsapp-rating 1-5 --whatsapp-reason TEXT
  report --root PATH [--title TEXT] [--language en|es] [--max-recommendations N]

Use --dry-run before any live UI run. See references/cli.md for all options.`;

function print(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
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
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === "help" || command === "--help" || command === "-h") return print(HELP);
  if (command === "doctor") return doctor(options);
  if (command === "list-presets") return print(await listPresets());
  if (command === "validate-workflow") return validateCommand(options);
  if (command === "capture-page") return captureCommand(options);
  if (command === "start" || command === "run") return startCommand(options);
  if (command === "shot") return shotCommand(options);
  if (command === "act") return actCommand(options);
  if (command === "save") return saveCommand(options);
  if (command === "reject") return rejectCommand(options);
  if (command === "status") return print(await statusAgentSession(sessionValue(options)));
  if (command === "finish") return finishCommand(options);
  if (command === "import-image") return importImageCommand(options);
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
