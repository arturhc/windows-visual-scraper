import fs from "node:fs/promises";
import path from "node:path";
import { createRunArtifacts, findDuplicateSha256, sha256File, slugify } from "./artifacts.mjs";
import { closeBrowserSession, openBrowserSession, sleep } from "./browser-session.mjs";
import { generateReport } from "./report.mjs";
import { createImageKnowledgeAsset } from "./knowledge-assets.mjs";
import { SAFE_KEYS } from "./workflow-schema.mjs";
import { windowsBrowser } from "./windows-bridge.mjs";

const SESSION_FILE = "session.json";
const MAX_ACTIONS = 500;
const MAX_SHOTS = 500;
const FINAL_STATUSES = new Set(["complete", "partial", "failed"]);
const PLATFORMS = new Set(["facebook", "instagram", "web"]);
const GENERIC_FILE_NAMES = new Set(["image", "photo", "picture", "capture", "screenshot", "imagen", "foto", "captura"]);
const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertWithin(root, target, label) {
  if (!isWithin(root, target)) throw new Error(`${label} must stay inside the session run directory.`);
  return path.resolve(target);
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function appendTrace(session, event, data = {}) {
  const record = { at: new Date().toISOString(), event, ...data };
  await fs.appendFile(session.tracePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  await writeJsonAtomic(session.sessionPath, session);
}

async function resolveSessionPath(value) {
  const resolved = path.resolve(value);
  const stats = await fs.stat(resolved);
  return stats.isDirectory() ? path.join(resolved, SESSION_FILE) : resolved;
}

function normalizeStageState(session) {
  const stages = Array.isArray(session.workflow?.stages) ? session.workflow.stages : [];
  let changed = false;
  if (!Array.isArray(session.completedStages)) {
    session.completedStages = [];
    changed = true;
  }
  if (!Number.isInteger(session.currentStageIndex)) {
    session.currentStageIndex = Math.min(stages.length, session.completedStages.length);
    changed = true;
  }
  const normalizedIndex = Math.min(stages.length, Math.max(0, session.currentStageIndex));
  if (normalizedIndex !== session.currentStageIndex) {
    session.currentStageIndex = normalizedIndex;
    changed = true;
  }
  return changed;
}

export function activeContextId(session) {
  const stages = Array.isArray(session.workflow?.stages) ? session.workflow.stages : [];
  return stages[session.currentStageIndex || 0]?.id || "collection";
}

export function completeWorkflowStage(session, context) {
  const expected = activeContextId(session);
  if (context !== expected || expected === "collection") {
    throw new Error(`Cannot complete context "${context}"; the active context is "${expected}".`);
  }
  if (!session.completedStages.includes(context)) session.completedStages.push(context);
  session.currentStageIndex += 1;
  return activeContextId(session);
}

export async function loadAgentSession(value, { active = false } = {}) {
  const sessionPath = await resolveSessionPath(value);
  const session = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  if (session.schemaVersion !== 1 || session.kind !== "agent-native") {
    throw new Error("The supplied file is not a supported agent session.");
  }
  session.sessionPath = sessionPath;
  assertWithin(session.runRoot, sessionPath, "Session path");
  assertWithin(session.runRoot, session.manifestPath, "Manifest path");
  assertWithin(session.runRoot, session.tracePath, "Trace path");
  let changed = normalizeStageState(session);
  try {
    const manifest = JSON.parse(await fs.readFile(session.manifestPath, "utf8"));
    if (session.status === "active" && FINAL_STATUSES.has(manifest.status)) {
      session.status = manifest.status;
      session.finishedAt = manifest.finishedAt || session.finishedAt;
      session.error = manifest.error || session.error;
      changed = true;
    }
  } catch {
    // The manifest is validated by the command that needs it.
  }
  if (changed) await saveSession(session);
  if (active && session.status !== "active") throw new Error(`Session is not active (status: ${session.status}).`);
  return session;
}

export function parseRatioPair(value, label = "ratio pair") {
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) {
    throw new Error(`${label} must contain two comma-separated ratios from 0 through 1.`);
  }
  return { xRatio: parts[0], yRatio: parts[1] };
}

export function parseCropBox(value) {
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) {
    throw new Error("--crop-box must contain left,top,right,bottom ratios from 0 through 1.");
  }
  const [leftRatio, topRatio, rightRatio, bottomRatio] = parts;
  if (rightRatio <= leftRatio || bottomRatio <= topRatio) {
    throw new Error("--crop-box right/bottom must be greater than left/top.");
  }
  if ((rightRatio - leftRatio) * (bottomRatio - topRatio) < 0.01) {
    throw new Error("--crop-box is too small; it must retain at least 1% of the frame.");
  }
  return { leftRatio, topRatio, rightRatio, bottomRatio };
}

export function inferPlatform(urlValue) {
  const host = new URL(urlValue).hostname.toLowerCase();
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com")) return "facebook";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  return "web";
}

export function deriveTargetLabel(urlValue) {
  const url = new URL(urlValue);
  let pathname = url.pathname.split("/").filter(Boolean)[0] || url.hostname.replace(/^www\./, "");
  try { pathname = decodeURIComponent(pathname); } catch {}
  return pathname.slice(0, 120);
}

export function normalizeSavedImageMetadata(metadata = {}) {
  const displayName = String(metadata.name || "").trim();
  const fileStem = slugify(displayName, "");
  if (!fileStem || GENERIC_FILE_NAMES.has(fileStem) || /^(?:image|photo|picture|capture|screenshot|imagen|foto|captura)-?\d*$/i.test(fileStem)) {
    throw new Error("--name must describe the visible image; generic names such as image, photo, or screenshot are not allowed.");
  }
  const description = String(metadata.description || "").trim();
  if (description.length < 8 || description.length > 500) {
    throw new Error("--description must contain 8 through 500 characters describing visible content.");
  }
  const rating = Number(metadata.whatsappRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("--whatsapp-rating must be an integer from 1 through 5.");
  }
  const reason = String(metadata.whatsappReason || "").trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new Error("--whatsapp-reason must contain 5 through 300 characters.");
  }
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    displayName,
    fileStem,
    description,
    tags,
    whatsapp: { rating, recommended: rating >= 4, reason },
  };
}

function contextDefinition(session, context) {
  const expected = activeContextId(session);
  if (context !== expected) {
    throw new Error(`Context "${context}" is not active. Continue with "${expected}".`);
  }
  if (context === "collection") {
    const advance = session.workflow.collection.advance;
    const allowedKeys = advance.mode === "key"
      ? [String(advance.key).toUpperCase()]
      : (advance.allowedKeys || []).map((key) => String(key).toUpperCase());
    const allowedActionTypes = advance.mode === "key"
      ? ["key", "wait", "done"]
      : advance.mode === "agent" && allowedKeys.length
        ? ["click", "key", "wait", "done"]
        : ["click", "wait", "done"];
    return {
      id: "collection",
      goal: advance.goal || "Advance to the next collection item.",
      guidance: advance.guidance || "Advance exactly one item.",
      allowedActionTypes,
      allowedKeys,
      maxSteps: advance.maxSteps || 10,
      settleMs: advance.waitMs,
      fixedClick: advance.mode === "click"
        ? { xRatio: advance.xRatio, yRatio: advance.yRatio }
        : undefined,
    };
  }
  const stage = session.workflow.stages.find((candidate) => candidate.id === context);
  if (!stage) throw new Error(`Unknown context: ${context}. Use a workflow stage id or collection.`);
  return stage;
}

export function validateAgentAction(context, action, usedSteps = 0) {
  if (usedSteps >= context.maxSteps) throw new Error(`Context "${context.id}" reached its ${context.maxSteps}-step limit.`);
  if (!context.allowedActionTypes.includes(action.type)) {
    throw new Error(`Action ${action.type} is not allowed in context "${context.id}".`);
  }
  if (action.type === "key") {
    const key = String(action.key || "").toUpperCase();
    if (!SAFE_KEYS.has(key) || !(context.allowedKeys || []).map((item) => item.toUpperCase()).includes(key)) {
      throw new Error(`Key ${key} is not allowed in context "${context.id}".`);
    }
    action.key = key;
  }
  if (action.type === "click") {
    for (const [label, value] of [["xRatio", action.xRatio], ["yRatio", action.yRatio]]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be from 0 through 1.`);
    }
    if (context.fixedClick && (action.xRatio !== context.fixedClick.xRatio || action.yRatio !== context.fixedClick.yRatio)) {
      throw new Error(`Context "${context.id}" requires the workflow's fixed click ratios.`);
    }
  }
  if (action.waitMs != null && (!Number.isInteger(action.waitMs) || action.waitMs < 0 || action.waitMs > 60_000)) {
    throw new Error("waitMs must be an integer from 0 through 60000.");
  }
  return action;
}

function nextShotPath(session, label = "frame") {
  const number = session.counters.shots + 1;
  return path.join(session.directories.screenshots, `${String(number).padStart(3, "0")}-${slugify(label)}.png`);
}

async function captureShot(session, label, context) {
  if (session.counters.shots >= MAX_SHOTS) throw new Error(`Session reached its ${MAX_SHOTS}-screenshot limit.`);
  const screenshotPath = nextShotPath(session, label);
  await windowsBrowser.screenshot(session.window, screenshotPath);
  session.counters.shots += 1;
  session.lastScreenshotPath = screenshotPath;
  await appendTrace(session, "screenshot", { path: screenshotPath, context });
  await saveSession(session);
  return screenshotPath;
}

function agentInstructions(session, context) {
  if (!context) {
    return agentInstructions(session, activeContextId(session));
  }
  const definition = contextDefinition(session, context);
  const instructions = {
    context: definition.id,
    goal: definition.goal,
    guidance: definition.guidance || "",
    allowedActionTypes: definition.allowedActionTypes,
    allowedKeys: definition.allowedKeys || [],
    remainingSteps: definition.maxSteps - (session.contextActions[definition.id] || 0),
    fallbackActions: definition.fallbackActions || [],
    forceFallbackAfterStep: definition.forceFallbackAfterStep,
    mustActBeforeDone: definition.mustActBeforeDone === true,
  };
  if (context === "collection") {
    instructions.inspectionPrompt = session.workflow.collection.inspectionPrompt;
    instructions.crop = session.workflow.collection.crop;
    instructions.advance = session.workflow.collection.advance;
    instructions.requestedCount = session.requestedCount;
  }
  return instructions;
}

export async function startAgentSession({ workflow, workflowPath, url, count, outputDir, options, collectionName, targetLabel, platform, reportLanguage, maxRecommendations = 5 }) {
  const requestedCount = Math.min(count ?? workflow.collection.defaultCount, workflow.collection.maxCount);
  const resolvedCollectionName = String(collectionName || "image-collection").trim().slice(0, 120) || "image-collection";
  const resolvedTargetLabel = String(targetLabel || deriveTargetLabel(url)).trim().slice(0, 120) || deriveTargetLabel(url);
  const resolvedPlatform = String(platform || inferPlatform(url)).toLowerCase();
  const resolvedReportLanguage = String(reportLanguage || "en").toLowerCase().startsWith("es") ? "es" : "en";
  if (!PLATFORMS.has(resolvedPlatform)) throw new Error(`Unsupported platform: ${resolvedPlatform}.`);
  const collectionRoot = path.join(path.resolve(outputDir), slugify(resolvedCollectionName, "image-collection"));
  const artifacts = await createRunArtifacts(collectionRoot, `${resolvedPlatform}-${resolvedTargetLabel}`, {
    kind: "agent-native",
    workflow: workflow.name,
    workflowPath,
    url,
    requestedCount,
    collectionName: resolvedCollectionName,
    targetLabel: resolvedTargetLabel,
    platform: resolvedPlatform,
    reportLanguage: resolvedReportLanguage,
  });
  const sessionPath = path.join(artifacts.directories.root, SESSION_FILE);
  let browserSession;
  let session;

  try {
    browserSession = await openBrowserSession(url, {
      ...options,
      launchWaitMs: options.launchWaitMs ?? workflow.browser?.launchWaitMs ?? 4_000,
      fullscreen: options.fullscreen ?? workflow.browser?.fullscreen ?? true,
    });
    session = {
      schemaVersion: 1,
      kind: "agent-native",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url,
      workflowPath,
      workflow,
      requestedCount,
      collectionName: resolvedCollectionName,
      collectionRoot,
      targetLabel: resolvedTargetLabel,
      platform: resolvedPlatform,
      reportLanguage: resolvedReportLanguage,
      maxRecommendations,
      runRoot: artifacts.directories.root,
      directories: artifacts.directories,
      manifestPath: artifacts.manifestPath,
      tracePath: artifacts.tracePath,
      sessionPath,
      window: browserSession.target,
      fullscreen: browserSession.fullscreen,
      keepOpen: options.keepOpen === true,
      defaultWaitMs: options.waitMs ?? 1_200,
      counters: { shots: 0, actions: 0, saves: 0, rejections: 0 },
      contextActions: {},
      currentStageIndex: 0,
      completedStages: [],
    };
    await artifacts.log("browser-ready", { window: session.window });
    await saveSession(session);
    const screenshotPath = await captureShot(session, "initial", workflow.stages[0].id);
    return {
      status: session.status,
      sessionPath,
      manifestPath: session.manifestPath,
      collectionRoot,
      screenshotPath,
      instructions: agentInstructions(session),
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const stateWarnings = [];
    try {
      await artifacts.log("start-error", { message: error.message, stack: error.stack });
    } catch (stateError) {
      stateWarnings.push(`trace: ${stateError.message}`);
    }
    try {
      await artifacts.writeManifest({ status: "failed", finishedAt, error: error.message });
    } catch (stateError) {
      stateWarnings.push(`manifest: ${stateError.message}`);
    }
    if (session) {
      session.status = "failed";
      session.finishedAt = finishedAt;
      session.error = error.message;
      try {
        await saveSession(session);
      } catch (stateError) {
        stateWarnings.push(`session: ${stateError.message}`);
      }
    }
    await closeBrowserSession(browserSession, options, async (event, data) => {
      try {
        await artifacts.log(event, data);
      } catch (stateError) {
        stateWarnings.push(`cleanup trace: ${stateError.message}`);
      }
    });
    if (stateWarnings.length) error.stateWarnings = stateWarnings;
    error.manifestPath = artifacts.manifestPath;
    throw error;
  }
}

export async function shotAgentSession({ sessionValue, label = "frame", context }) {
  const session = await loadAgentSession(sessionValue, { active: true });
  const activeContext = context || activeContextId(session);
  contextDefinition(session, activeContext);
  const screenshotPath = await captureShot(session, label, activeContext);
  return { status: session.status, sessionPath: session.sessionPath, screenshotPath, instructions: agentInstructions(session, activeContext) };
}

async function executeAction(session, action) {
  if (action.type === "done") return;
  if (action.type === "wait") {
    await sleep(action.waitMs ?? session.defaultWaitMs);
    return;
  }
  if (action.type === "key") await windowsBrowser.key(session.window, action.key);
  if (action.type === "click") {
    const rect = await windowsBrowser.rect(session.window);
    const x = Math.min(rect.width - 1, Math.max(0, Math.round(rect.width * action.xRatio)));
    const y = Math.min(rect.height - 1, Math.max(0, Math.round(rect.height * action.yRatio)));
    await windowsBrowser.click(session.window, x, y);
  }
  await sleep(action.waitMs ?? session.defaultWaitMs);
}

export async function actAgentSession({ sessionValue, context, action }) {
  const session = await loadAgentSession(sessionValue, { active: true });
  if (session.counters.actions >= MAX_ACTIONS) throw new Error(`Session reached its ${MAX_ACTIONS}-action limit.`);
  const definition = contextDefinition(session, context);
  const usedSteps = session.contextActions[definition.id] || 0;
  validateAgentAction(definition, action, usedSteps);
  if (action.type !== "wait" && action.type !== "done" && action.waitMs == null && definition.settleMs != null) {
    action.waitMs = definition.settleMs;
  }
  await windowsBrowser.focus(session.window);
  await executeAction(session, action);
  session.counters.actions += 1;
  session.contextActions[definition.id] = usedSteps + 1;
  const nextContext = action.type === "done" && context !== "collection"
    ? completeWorkflowStage(session, context)
    : context;
  await appendTrace(session, "agent-action", { context, action, nextContext });
  await saveSession(session);
  const screenshotPath = await captureShot(session, `${context}-after-action`, nextContext);
  return {
    status: session.status,
    sessionPath: session.sessionPath,
    action,
    screenshotPath,
    instructions: agentInstructions(session, nextContext),
  };
}

async function readManifest(session) {
  return JSON.parse(await fs.readFile(session.manifestPath, "utf8"));
}

async function writeManifest(session, manifest) {
  await writeJsonAtomic(session.manifestPath, manifest);
}

export async function saveAgentFrame({ sessionValue, inputPath, method, cropBox, metadata, analysis }) {
  const session = await loadAgentSession(sessionValue, { active: true });
  const normalizedMetadata = normalizeSavedImageMetadata(metadata);
  const sourcePath = await fs.realpath(path.resolve(inputPath));
  const realRunRoot = await fs.realpath(session.runRoot);
  assertWithin(realRunRoot, sourcePath, "Input image");
  if (path.extname(sourcePath).toLowerCase() !== ".png") throw new Error("Only PNG session screenshots can be saved.");

  const crop = session.workflow.collection.crop;
  if (method === "agent" && !new Set(["agent", "agent-or-heuristic"]).has(crop.mode)) {
    throw new Error(`Workflow crop mode ${crop.mode} does not allow an agent crop box.`);
  }
  if (method === "heuristic" && !new Set(["heuristic", "agent-or-heuristic"]).has(crop.mode)) {
    throw new Error(`Workflow crop mode ${crop.mode} does not allow heuristic cropping.`);
  }
  if (method === "full-window" && crop.mode !== "none") {
    throw new Error(`Workflow crop mode ${crop.mode} does not allow saving the full window.`);
  }

  const candidatePath = path.join(session.directories.raw, `candidate-${String(session.counters.saves + 1).padStart(3, "0")}.png`);
  if (method === "agent") {
    await windowsBrowser.cropRatios(sourcePath, candidatePath, cropBox, crop.padding || 0);
  } else if (method === "heuristic") {
    await windowsBrowser.cropHeuristic(sourcePath, candidatePath, crop.searchRightRatio ?? 0.82, crop.padding ?? 8);
  } else {
    await fs.copyFile(sourcePath, candidatePath);
  }

  const manifest = await readManifest(session);
  if (manifest.items.length >= session.requestedCount) {
    await fs.rm(candidatePath, { force: true });
    throw new Error(`The requested image count (${session.requestedCount}) has already been reached.`);
  }
  const hash = await sha256File(candidatePath);
  const localDuplicate = manifest.items.find((item) => item.sha256 === hash);
  const collectionDuplicate = localDuplicate
    ? null
    : await findDuplicateSha256(session.collectionRoot || session.runRoot, hash, { excludeManifestPath: session.manifestPath });
  if (localDuplicate || collectionDuplicate) {
    await fs.rm(candidatePath, { force: true });
    const duplicateOf = localDuplicate
      ? localDuplicate.path
      : `${portable(session.collectionRoot || session.runRoot, collectionDuplicate.manifestPath)}#${collectionDuplicate.item.path}`;
    manifest.rejectedFrames.push({ input: portable(session.runRoot, sourcePath), reason: "duplicate", sha256: hash, duplicateOf });
    await writeManifest(session, manifest);
    await appendTrace(session, "frame-rejected", { reason: "duplicate", sha256: hash, duplicateOf });
    return { status: "duplicate", sessionPath: session.sessionPath, sha256: hash, duplicateOf };
  }

  const index = manifest.items.length + 1;
  const finalPath = path.join(session.directories.media, `${String(index).padStart(3, "0")}-${normalizedMetadata.fileStem}.png`);
  await fs.rename(candidatePath, finalPath);
  const item = {
    index,
    path: portable(session.runRoot, finalPath),
    sha256: hash,
    cropSource: method,
    name: normalizedMetadata.fileStem,
    displayName: normalizedMetadata.displayName,
    description: normalizedMetadata.description,
    tags: normalizedMetadata.tags,
    whatsapp: normalizedMetadata.whatsapp,
  };
  await createImageKnowledgeAsset({ imagePath: finalPath, item, manifest, runRoot: session.runRoot, analysis });
  manifest.items.push(item);
  await writeManifest(session, manifest);
  session.counters.saves += 1;
  session.contextActions.collection = 0;
  await appendTrace(session, "frame-saved", {
    index,
    path: finalPath,
    sha256: hash,
    cropSource: method,
    name: normalizedMetadata.fileStem,
    whatsappRating: normalizedMetadata.whatsapp.rating,
  });
  await saveSession(session);
  return {
    status: "saved",
    sessionPath: session.sessionPath,
    manifestPath: session.manifestPath,
    imagePath: finalPath,
    displayName: normalizedMetadata.displayName,
    whatsapp: normalizedMetadata.whatsapp,
    sha256: hash,
    captured: manifest.items.length,
    requested: session.requestedCount,
  };
}

export async function rejectAgentFrame({ sessionValue, inputPath, reason, mediaType }) {
  const session = await loadAgentSession(sessionValue, { active: true });
  const sourcePath = await fs.realpath(path.resolve(inputPath));
  const realRunRoot = await fs.realpath(session.runRoot);
  assertWithin(realRunRoot, sourcePath, "Input image");
  const manifest = await readManifest(session);
  manifest.rejectedFrames.push({
    input: portable(session.runRoot, sourcePath),
    reason,
    ...(mediaType ? { mediaType } : {}),
  });
  await writeManifest(session, manifest);
  session.counters.rejections += 1;
  session.contextActions.collection = 0;
  await appendTrace(session, "frame-rejected", { input: sourcePath, reason, mediaType });
  await saveSession(session);
  return { status: "rejected", sessionPath: session.sessionPath, rejected: manifest.rejectedFrames.length };
}

export async function statusAgentSession(sessionValue) {
  const session = await loadAgentSession(sessionValue);
  const manifest = await readManifest(session);
  return {
    status: session.status,
    sessionPath: session.sessionPath,
    manifestPath: session.manifestPath,
    collectionRoot: session.collectionRoot,
    reportPath: session.reportPath,
    lastScreenshotPath: session.lastScreenshotPath,
    captured: manifest.items.length,
    rejected: manifest.rejectedFrames.length,
    requested: session.requestedCount,
    counters: session.counters,
    activeContext: activeContextId(session),
    completedStages: session.completedStages,
  };
}

export async function finishAgentSession({ sessionValue, status, reason, summary }) {
  const session = await loadAgentSession(sessionValue);
  if (session.status !== "active") {
    const report = await generateReport(session.collectionRoot || session.runRoot, { title: session.collectionName, language: session.reportLanguage, maxRecommendations: session.maxRecommendations ?? 5 });
    session.reportPath = report.reportPath;
    await saveSession(session);
    return statusAgentSession(session.sessionPath);
  }
  if (!FINAL_STATUSES.has(status)) throw new Error(`Finish status must be one of: ${[...FINAL_STATUSES].join(", ")}.`);
  const manifest = await readManifest(session);
  session.status = status;
  session.finishedAt = new Date().toISOString();
  if (reason) session.reason = reason;
  if (summary) session.summary = String(summary).trim().slice(0, 1000);
  await appendTrace(session, "session-finished", { status, reason });
  await closeBrowserSession(
    { window: session.window, fullscreen: session.fullscreen },
    { keepOpen: session.keepOpen },
    (event, data) => appendTrace(session, event, data),
  );
  manifest.status = status;
  manifest.finishedAt = session.finishedAt;
  if (reason) manifest.reason = reason;
  if (session.summary) manifest.summary = session.summary;
  await writeManifest(session, manifest);
  const report = await generateReport(session.collectionRoot || session.runRoot, { title: session.collectionName, language: session.reportLanguage, maxRecommendations: session.maxRecommendations ?? 5 });
  session.reportPath = report.reportPath;
  await saveSession(session);
  return { ...(await statusAgentSession(session.sessionPath)), report };
}
