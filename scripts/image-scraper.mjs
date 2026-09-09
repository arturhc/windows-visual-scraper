#!/usr/bin/env node
import fs from "node:fs/promises";
import { parseCli, readBoolean, readInteger, requireOption, resolveOutputDir, assertHttpUrl, assertLiveUiAuthorized, assertEdgeProfile } from "./lib/args.mjs";
import { hasOpenAiKey, resolveVisionConfig } from "./lib/config.mjs";
import { createVisionClient } from "./lib/openai-vision.mjs";
import { capturePage, runWorkflow } from "./lib/runner.mjs";
import { helperPath, windowsBrowser } from "./lib/windows-bridge.mjs";
import { listPresets, loadWorkflow, validateWorkflow } from "./lib/workflow-schema.mjs";

const HELP = `Windows Visual Image Scraper\n\nCommands:\n  doctor\n  list-presets\n  validate-workflow --all | --workflow PATH\n  capture-page --url URL [--shots N] [--dry-run | --confirm-live-ui]\n  run (--preset NAME | --workflow PATH) --url URL [--count N] [--dry-run | --confirm-live-ui]\n\nUse --dry-run before any live UI run. See references/cli.md for all options.`;

function print(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function runtimeOptions(options) {
  return {
    profile: assertEdgeProfile(typeof options.profile === "string" ? options.profile : "Default"),
    launchWaitMs: readInteger(options["launch-wait-ms"], 4_000, { min: 0, max: 60_000 }),
    waitMs: readInteger(options["wait-ms"], 1_200, { min: 0, max: 60_000 }),
    pauseForLogin: readBoolean(options["pause-for-login"]),
    fullscreen: readBoolean(options.fullscreen, true),
    resetScroll: readBoolean(options["reset-scroll"], true),
    keepOpen: readBoolean(options["keep-open"]),
    trace: readBoolean(options.trace, true),
  };
}

async function doctor() {
  const report = {
    platform: process.platform,
    node: process.version,
    helperPath,
    helperReadable: false,
    openAiKeyConfigured: hasOpenAiKey(),
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
  if (readBoolean(options["dry-run"])) { print({ dryRun: true, plan }); return; }
  assertLiveUiAuthorized(options);
  if (process.platform !== "win32") throw new Error("Live capture is supported only on Windows.");
  const result = await capturePage(plan);
  print({ status: result.manifest.status, captured: result.manifest.items.length, manifestPath: result.manifestPath });
}

async function runCommand(options) {
  const preset = typeof options.preset === "string" ? options.preset : undefined;
  const workflowPath = typeof options.workflow === "string" ? options.workflow : undefined;
  const loaded = await loadWorkflow({ preset, workflowPath });
  const url = assertHttpUrl(requireOption(options, "url"));
  const count = readInteger(options.count, loaded.workflow.collection.defaultCount, { min: 1, max: 100 });
  const plan = {
    command: "run",
    workflow: loaded.workflow.name,
    workflowPath: loaded.path,
    url,
    count: Math.min(count, loaded.workflow.collection.maxCount),
    outputDir: resolveOutputDir(options),
    options: runtimeOptions(options),
    vision: { ...resolveVisionConfig(options), apiKey: hasOpenAiKey() ? "configured" : "missing", organization: undefined },
  };
  if (readBoolean(options["dry-run"])) { print({ dryRun: true, plan }); return; }
  assertLiveUiAuthorized(options);
  if (process.platform !== "win32") throw new Error("Live workflow runs are supported only on Windows.");
  if (!hasOpenAiKey()) throw new Error("OPENAI_API_KEY is required for a live visual extraction workflow.");
  const vision = createVisionClient(resolveVisionConfig(options));
  const result = await runWorkflow({ ...plan, vision, workflow: loaded.workflow });
  print({ status: result.manifest.status, captured: result.manifest.items.length, requested: result.manifest.requestedCount, manifestPath: result.manifestPath });
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  if (command === "help" || command === "--help" || command === "-h") return print(HELP);
  if (command === "doctor") return doctor();
  if (command === "list-presets") return print(await listPresets());
  if (command === "validate-workflow") return validateCommand(options);
  if (command === "capture-page") return captureCommand(options);
  if (command === "run") return runCommand(options);
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.manifestPath) process.stderr.write(`Manifest: ${error.manifestPath}\n`);
    process.exitCode = 1;
  });
}
