#!/usr/bin/env node
import fs from "node:fs/promises";
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
  finishAgentSession,
  parseCropBox,
  parseRatioPair,
  rejectAgentFrame,
  saveAgentFrame,
  shotAgentSession,
  startAgentSession,
  statusAgentSession,
} from "./lib/agent-session.mjs";
import { capturePage } from "./lib/runner.mjs";
import { helperPath, windowsBrowser } from "./lib/windows-bridge.mjs";
import { listPresets, loadWorkflow, validateWorkflow } from "./lib/workflow-schema.mjs";

const HELP = `Windows Visual Image Scraper

Codex or another image-capable code agent is the visual reasoning engine.
The bundled scripts do not call an AI API and do not require a separate API key.

Commands:
  doctor
  list-presets
  validate-workflow --all | --workflow PATH
  capture-page --url URL [--shots N] [--dry-run | --confirm-live-ui]
  start (--preset NAME | --workflow PATH) --url URL [--count N] [--dry-run | --confirm-live-ui]
  shot --session PATH [--context STAGE_ID|collection] [--label TEXT]
  act --session PATH --context STAGE_ID|collection (--click X,Y | --key KEY | --wait-ms N | --done)
  save --session PATH --input PNG (--crop-box L,T,R,B | --heuristic | --full-window)
  reject --session PATH --input PNG --reason TEXT [--media-type TEXT]
  status --session PATH
  finish --session PATH [--status complete|partial|failed] [--reason TEXT]

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

async function doctor() {
  const report = {
    platform: process.platform,
    node: process.version,
    helperPath,
    helperReadable: false,
    agentNative: true,
    aiApiRequired: false,
    windowsRuntime: null,
  };
  try { await fs.access(helperPath); report.helperReadable = true; } catch {}
  if (process.platform === "win32" && report.helperReadable) {
    try { report.windowsRuntime = await windowsBrowser.doctor(); }
    catch (error) { report.windowsRuntime = { ok: false, error: error.message }; }
  }
  report.ok = report.platform === "win32" && report.helperReadable && !report.windowsRuntime?.error;
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
  const plan = {
    command: "start",
    workflow: loaded.workflow.name,
    workflowPath: loaded.path,
    url,
    count: Math.min(count, loaded.workflow.collection.maxCount),
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
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === "help" || command === "--help" || command === "-h") return print(HELP);
  if (command === "doctor") return doctor();
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
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.manifestPath) process.stderr.write(`Manifest: ${error.manifestPath}\n`);
    process.exitCode = 1;
  });
}
