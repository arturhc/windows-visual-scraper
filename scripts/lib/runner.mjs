import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRunArtifacts, sha256File, slugify } from "./artifacts.mjs";
import { windowsBrowser, waitForCreatedEdgeWindow } from "./windows-bridge.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

async function pauseForUser(message) {
  const terminal = readline.createInterface({ input, output });
  try { await terminal.question(`${message}\nPress Enter to continue... `); } finally { terminal.close(); }
}

async function openSession(url, options) {
  const before = await windowsBrowser.listWindows();
  const launch = await windowsBrowser.open(url, options.profile || "Default");
  const target = await waitForCreatedEdgeWindow(before, launch, new URL(url).hostname);
  await sleep(options.launchWaitMs ?? 4_000);
  await windowsBrowser.focus(target);
  await windowsBrowser.maximize(target);
  if (options.pauseForLogin) {
    await pauseForUser("Review the new Edge window and sign in if needed.");
    await windowsBrowser.focus(target);
    await windowsBrowser.maximize(target);
  }
  if (options.fullscreen !== false) {
    await windowsBrowser.key(target, "F11");
    await sleep(700);
  }
  return { target, fullscreen: options.fullscreen !== false };
}

async function closeSession(session, options, log) {
  if (!session?.target) return;
  try {
    if (session.fullscreen) {
      await windowsBrowser.key(session.target, "F11");
      await sleep(250);
    }
  } catch (error) {
    await log("cleanup-warning", { message: `Could not leave fullscreen: ${error.message}` });
  }
  if (!options.keepOpen) {
    try { await windowsBrowser.close(session.target); } catch (error) {
      await log("cleanup-warning", { message: `Could not close Edge window: ${error.message}` });
    }
  }
}

function fallbackFor(stage, step) {
  const actions = stage.fallbackActions?.length ? stage.fallbackActions : [{ type: "done" }];
  return { ...actions[Math.min(step - 1, actions.length - 1)], source: "fallback" };
}

function normalizeAction(candidate, fallback, stage) {
  const allowedTypes = new Set(stage.allowedActionTypes);
  const allowedKeys = new Set((stage.allowedKeys || []).map((key) => key.toUpperCase()));
  const type = allowedTypes.has(candidate?.type) ? candidate.type : fallback.type;
  if (type === "key" && !allowedKeys.has(String(candidate?.key || "").toUpperCase())) return fallback;
  if (type === "click" && ![candidate?.xRatio, candidate?.yRatio].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return fallback;
  return {
    type,
    key: type === "key" ? String(candidate.key).toUpperCase() : undefined,
    xRatio: type === "click" ? candidate.xRatio : undefined,
    yRatio: type === "click" ? candidate.yRatio : undefined,
    waitMs: Number.isFinite(candidate?.waitMs) ? Math.min(60_000, Math.max(0, candidate.waitMs)) : (fallback.waitMs ?? 800),
    reason: candidate?.reason || fallback.reason || "No reason supplied.",
    source: candidate?.source || "vision",
  };
}

async function executeAction(windowInfo, action) {
  if (action.type === "done") return;
  if (action.type === "wait") {
    await sleep(action.waitMs || 800);
    return;
  }
  if (action.type === "key") await windowsBrowser.key(windowInfo, action.key);
  if (action.type === "click") {
    const rect = await windowsBrowser.rect(windowInfo);
    const x = Math.min(rect.width - 1, Math.max(0, Math.round(rect.width * action.xRatio)));
    const y = Math.min(rect.height - 1, Math.max(0, Math.round(rect.height * action.yRatio)));
    await windowsBrowser.click(windowInfo, x, y);
  }
  if (action.waitMs) await sleep(action.waitMs);
}

async function driveStage({ stage, stageIndex, windowInfo, vision, artifacts, trace }) {
  let acted = false;
  for (let step = 1; step <= stage.maxSteps; step += 1) {
    const fallback = fallbackFor(stage, step);
    const screenshot = path.join(
      trace ? artifacts.directories.trace : artifacts.directories.raw,
      `stage-${String(stageIndex + 1).padStart(2, "0")}-${slugify(stage.id)}-step-${String(step).padStart(2, "0")}.png`,
    );
    await windowsBrowser.screenshot(windowInfo, screenshot);

    let candidate;
    if (stage.forceFallbackAfterStep && step > stage.forceFallbackAfterStep) {
      candidate = fallback;
    } else {
      try { candidate = { ...(await vision.decideAction(screenshot, stage, step)), source: "vision" }; }
      catch (error) {
        candidate = { ...fallback, reason: `Visual planning failed: ${error.message}` };
      }
    }
    const action = normalizeAction(candidate, fallback, stage);
    if (action.type === "done" && stage.mustActBeforeDone && !acted) {
      Object.assign(action, normalizeAction(fallback.type === "done" ? { type: "wait", waitMs: 600 } : fallback, { type: "wait", waitMs: 600 }, stage));
    }
    await artifacts.log("stage-decision", { stage: stage.id, step, action });
    if (action.type === "done") return;
    await executeAction(windowInfo, action);
    acted = acted || !new Set(["wait", "done"]).has(action.type);
    if (stage.settleMs) await sleep(stage.settleMs);
  }
  throw new Error(`Stage "${stage.id}" did not complete within ${stage.maxSteps} steps.`);
}

async function saveCandidate({ rawPath, candidatePath, inspection, crop, windowInfo }) {
  if (crop.mode === "none") {
    await fs.copyFile(rawPath, candidatePath);
    return "full-window";
  }
  if ((crop.mode === "vision" || crop.mode === "vision-or-heuristic") && inspection.crop) {
    await windowsBrowser.cropRatios(rawPath, candidatePath, inspection.crop, crop.padding || 0);
    return "vision";
  }
  if (crop.mode === "vision") throw new Error("The visual model did not return a usable crop box.");
  await windowsBrowser.cropHeuristic(rawPath, candidatePath, crop.searchRightRatio ?? 0.82, crop.padding ?? 8);
  return "heuristic";
}

async function refineCandidate(candidatePath, vision, windowInfo) {
  const crop = await vision.refineCrop(candidatePath);
  if (!crop) return false;
  const retainedArea = (crop.rightRatio - crop.leftRatio) * (crop.bottomRatio - crop.topRatio);
  if (retainedArea > 0.97 || retainedArea < 0.08) return false;
  const refinedPath = `${candidatePath}.refined.png`;
  await windowsBrowser.cropRatios(candidatePath, refinedPath, crop, 0);
  await fs.rename(refinedPath, candidatePath);
  return true;
}

async function advanceCollection({ advance, windowInfo, vision, artifacts, attempt }) {
  if (advance.mode === "key") {
    await windowsBrowser.key(windowInfo, advance.key);
    await sleep(advance.waitMs ?? 800);
    return true;
  }
  if (advance.mode === "click") {
    await executeAction(windowInfo, { type: "click", xRatio: advance.xRatio, yRatio: advance.yRatio, waitMs: advance.waitMs ?? 800 });
    return true;
  }

  const stage = {
    goal: advance.goal,
    guidance: advance.guidance || "Select the visible control that advances to the next publication, not an inner carousel item unless explicitly stated.",
    allowedActionTypes: ["click", "wait", "done"],
    allowedKeys: [],
    maxSteps: advance.maxSteps || 3,
  };
  for (let step = 1; step <= stage.maxSteps; step += 1) {
    const screenshot = path.join(artifacts.directories.raw, `advance-${String(attempt).padStart(3, "0")}-${step}.png`);
    await windowsBrowser.screenshot(windowInfo, screenshot);
    const candidate = await vision.decideAction(screenshot, stage, step);
    const action = normalizeAction(candidate, { type: "done", waitMs: 700 }, stage);
    await artifacts.log("advance-decision", { attempt, step, action });
    if (action.type === "done") return false;
    await executeAction(windowInfo, action);
    if (action.type === "click") return true;
  }
  return false;
}

export async function runWorkflow({ workflow, workflowPath, url, count, outputDir, options, vision }) {
  const requestedCount = Math.min(count ?? workflow.collection.defaultCount, workflow.collection.maxCount);
  const artifacts = await createRunArtifacts(outputDir, workflow.name, {
    kind: "workflow",
    workflow: workflow.name,
    workflowPath,
    url,
    requestedCount,
  });
  let session;
  let terminalError;
  const seenHashes = new Set();

  try {
    session = await openSession(url, {
      ...options,
      launchWaitMs: options.launchWaitMs ?? workflow.browser?.launchWaitMs ?? 4_000,
      fullscreen: options.fullscreen ?? workflow.browser?.fullscreen ?? true,
    });
    await artifacts.log("browser-ready", { window: session.target });

    for (const [stageIndex, stage] of workflow.stages.entries()) {
      await driveStage({ stage, stageIndex, windowInfo: session.target, vision, artifacts, trace: options.trace });
    }

    const maximumAttempts = requestedCount * workflow.collection.maxAttemptsPerItem;
    for (let attempt = 1; attempt <= maximumAttempts && artifacts.manifest.items.length < requestedCount; attempt += 1) {
      const rawPath = path.join(artifacts.directories.raw, `frame-${String(attempt).padStart(3, "0")}.png`);
      await windowsBrowser.screenshot(session.target, rawPath);
      const inspection = await vision.inspectFrame(rawPath, workflow.collection.inspectionPrompt);
      await artifacts.log("frame-inspection", { attempt, inspection });

      if (inspection.accept && inspection.viewerOpen && inspection.mediaType === "still-image") {
        const candidatePath = path.join(artifacts.directories.raw, `candidate-${String(attempt).padStart(3, "0")}.png`);
        try {
          const cropSource = await saveCandidate({
            rawPath,
            candidatePath,
            inspection,
            crop: workflow.collection.crop,
            windowInfo: session.target,
          });
          let refined = false;
          if (workflow.collection.crop.refineWithVision) {
            try { refined = await refineCandidate(candidatePath, vision, session.target); }
            catch (error) { await artifacts.log("crop-refine-warning", { attempt, message: error.message }); }
          }
          const hash = await sha256File(candidatePath);
          if (seenHashes.has(hash)) {
            artifacts.manifest.rejectedFrames.push({ attempt, reason: "duplicate", hash });
            await fs.rm(candidatePath, { force: true });
          } else {
            seenHashes.add(hash);
            const itemNumber = artifacts.manifest.items.length + 1;
            const finalPath = path.join(artifacts.directories.media, `image-${String(itemNumber).padStart(3, "0")}.png`);
            await fs.rename(candidatePath, finalPath);
            artifacts.manifest.items.push({
              index: itemNumber,
              path: portable(artifacts.directories.root, finalPath),
              sha256: hash,
              cropSource,
              refined,
              confidence: inspection.confidence,
            });
            await artifacts.writeManifest();
          }
        } catch (error) {
          artifacts.manifest.rejectedFrames.push({ attempt, reason: `crop-failed: ${error.message}` });
        }
      } else {
        artifacts.manifest.rejectedFrames.push({ attempt, reason: inspection.reason, mediaType: inspection.mediaType });
      }

      if (artifacts.manifest.items.length >= requestedCount) break;
      const advanced = await advanceCollection({
        advance: workflow.collection.advance,
        windowInfo: session.target,
        vision,
        artifacts,
        attempt,
      });
      if (!advanced) break;
    }

    const status = artifacts.manifest.items.length === requestedCount ? "complete" : "partial";
    await artifacts.writeManifest({ status, finishedAt: new Date().toISOString() });
  } catch (error) {
    terminalError = error;
    await artifacts.log("run-error", { message: error.message, stack: error.stack });
    await artifacts.writeManifest({ status: artifacts.manifest.items.length ? "partial" : "failed", finishedAt: new Date().toISOString(), error: error.message });
  } finally {
    await closeSession(session, options, artifacts.log);
  }

  if (terminalError) {
    terminalError.manifestPath = artifacts.manifestPath;
    throw terminalError;
  }
  return { manifest: artifacts.manifest, manifestPath: artifacts.manifestPath, root: artifacts.directories.root };
}

export async function capturePage({ url, outputDir, shots, stepPages, options }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const artifacts = await createRunArtifacts(outputDir, `page-${host}`, {
    kind: "page-capture",
    url,
    requestedCount: shots,
  });
  let session;
  let terminalError;
  try {
    session = await openSession(url, options);
    if (options.resetScroll !== false) {
      await windowsBrowser.key(session.target, "HOME");
      await sleep(options.waitMs ?? 1_200);
    }
    for (let index = 1; index <= shots; index += 1) {
      const filePath = path.join(artifacts.directories.screenshots, `viewport-${String(index).padStart(3, "0")}.png`);
      await windowsBrowser.screenshot(session.target, filePath);
      artifacts.manifest.items.push({ index, path: portable(artifacts.directories.root, filePath), sha256: await sha256File(filePath) });
      await artifacts.log("viewport-captured", { index, path: filePath });
      await artifacts.writeManifest();
      if (index < shots && stepPages > 0) {
        await windowsBrowser.key(session.target, "PGDN", stepPages);
        await sleep(options.waitMs ?? 1_200);
      }
    }
    await artifacts.writeManifest({ status: "complete", finishedAt: new Date().toISOString() });
  } catch (error) {
    terminalError = error;
    await artifacts.log("run-error", { message: error.message, stack: error.stack });
    await artifacts.writeManifest({ status: artifacts.manifest.items.length ? "partial" : "failed", finishedAt: new Date().toISOString(), error: error.message });
  } finally {
    await closeSession(session, options, artifacts.log);
  }
  if (terminalError) {
    terminalError.manifestPath = artifacts.manifestPath;
    throw terminalError;
  }
  return { manifest: artifacts.manifest, manifestPath: artifacts.manifestPath, root: artifacts.directories.root };
}
