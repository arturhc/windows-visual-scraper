import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ACTION_TYPES = new Set(["click", "key", "wait", "done"]);
export const SAFE_KEYS = new Set([
  "HOME",
  "END",
  "PGDN",
  "LEFT",
  "RIGHT",
  "ESC",
  "ENTER",
  "SPACE",
  "F11",
]);
export const CROP_MODES = new Set(["agent", "agent-or-heuristic", "heuristic", "none"]);
export const ADVANCE_MODES = new Set(["key", "click", "agent"]);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(moduleDir, "..", "..");
export const presetsDir = path.join(skillRoot, "scripts", "workflows");

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertRatio(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number from 0 through 1.`);
  }
}

function validateAction(action, label) {
  assertObject(action, label);
  const type = String(action.type || "").toLowerCase();
  if (!ACTION_TYPES.has(type)) throw new Error(`${label}.type is unsupported: ${action.type}`);
  if (type === "click") {
    assertRatio(action.xRatio, `${label}.xRatio`);
    assertRatio(action.yRatio, `${label}.yRatio`);
  }
  if (type === "key" && !SAFE_KEYS.has(String(action.key || "").toUpperCase())) {
    throw new Error(`${label}.key is unsupported: ${action.key}`);
  }
  if (action.waitMs != null && (!Number.isFinite(action.waitMs) || action.waitMs < 0 || action.waitMs > 60_000)) {
    throw new Error(`${label}.waitMs must be between 0 and 60000.`);
  }
}

export function validateWorkflow(workflow) {
  assertObject(workflow, "workflow");
  if (workflow.version !== 2) throw new Error("workflow.version must be 2.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(workflow.name || ""))) {
    throw new Error("workflow.name must be lowercase hyphen-case.");
  }

  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0 || workflow.stages.length > 20) {
    throw new Error("workflow.stages must contain 1 through 20 stages.");
  }

  const ids = new Set();
  for (const [stageIndex, stage] of workflow.stages.entries()) {
    const label = `workflow.stages[${stageIndex}]`;
    assertObject(stage, label);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(stage.id || ""))) {
      throw new Error(`${label}.id must be lowercase hyphen-case.`);
    }
    if (ids.has(stage.id)) throw new Error(`Duplicate stage id: ${stage.id}`);
    ids.add(stage.id);
    if (!String(stage.goal || "").trim()) throw new Error(`${label}.goal is required.`);
    if (!Array.isArray(stage.allowedActionTypes) || stage.allowedActionTypes.length === 0) {
      throw new Error(`${label}.allowedActionTypes is required.`);
    }
    for (const type of stage.allowedActionTypes) {
      if (!ACTION_TYPES.has(type)) throw new Error(`${label} allows unsupported action: ${type}`);
    }
    for (const key of stage.allowedKeys || []) {
      if (!SAFE_KEYS.has(String(key).toUpperCase())) throw new Error(`${label} allows unsupported key: ${key}`);
    }
    if (!Number.isInteger(stage.maxSteps) || stage.maxSteps < 1 || stage.maxSteps > 30) {
      throw new Error(`${label}.maxSteps must be an integer from 1 through 30.`);
    }
    if (stage.forceFallbackAfterStep != null && (!Number.isInteger(stage.forceFallbackAfterStep) || stage.forceFallbackAfterStep < 1 || stage.forceFallbackAfterStep > stage.maxSteps)) {
      throw new Error(`${label}.forceFallbackAfterStep must be between 1 and maxSteps.`);
    }
    if (stage.settleMs != null && (!Number.isInteger(stage.settleMs) || stage.settleMs < 0 || stage.settleMs > 60_000)) {
      throw new Error(`${label}.settleMs must be between 0 and 60000.`);
    }
    for (const [actionIndex, action] of (stage.fallbackActions || []).entries()) {
      validateAction(action, `${label}.fallbackActions[${actionIndex}]`);
      if (!stage.allowedActionTypes.includes(action.type)) {
        throw new Error(`${label} fallback action ${action.type} is not allowed by the stage.`);
      }
      if (action.type === "key" && !(stage.allowedKeys || []).includes(String(action.key).toUpperCase())) {
        throw new Error(`${label} fallback key ${action.key} is not allowed by the stage.`);
      }
    }
  }

  assertObject(workflow.collection, "workflow.collection");
  const collection = workflow.collection;
  if (!Number.isInteger(collection.defaultCount) || collection.defaultCount < 1 || collection.defaultCount > 100) {
    throw new Error("workflow.collection.defaultCount must be an integer from 1 through 100.");
  }
  if (!Number.isInteger(collection.maxCount) || collection.maxCount < collection.defaultCount || collection.maxCount > 100) {
    throw new Error("workflow.collection.maxCount must be between defaultCount and 100.");
  }
  if (!Number.isInteger(collection.maxAttemptsPerItem) || collection.maxAttemptsPerItem < 1 || collection.maxAttemptsPerItem > 30) {
    throw new Error("workflow.collection.maxAttemptsPerItem must be an integer from 1 through 30.");
  }
  if (!String(collection.inspectionPrompt || "").trim()) {
    throw new Error("workflow.collection.inspectionPrompt is required.");
  }

  assertObject(collection.crop, "workflow.collection.crop");
  if (!CROP_MODES.has(collection.crop.mode)) {
    throw new Error(`Unsupported crop mode: ${collection.crop.mode}`);
  }
  if (collection.crop.searchRightRatio != null) {
    assertRatio(collection.crop.searchRightRatio, "workflow.collection.crop.searchRightRatio");
  }
  if (collection.crop.padding != null && (!Number.isInteger(collection.crop.padding) || collection.crop.padding < 0 || collection.crop.padding > 100)) {
    throw new Error("workflow.collection.crop.padding must be an integer from 0 through 100.");
  }

  assertObject(collection.advance, "workflow.collection.advance");
  if (!ADVANCE_MODES.has(collection.advance.mode)) {
    throw new Error(`Unsupported advance mode: ${collection.advance.mode}`);
  }
  if (collection.advance.mode === "key" && !SAFE_KEYS.has(String(collection.advance.key || "").toUpperCase())) {
    throw new Error(`Unsupported advance key: ${collection.advance.key}`);
  }
  if (collection.advance.mode === "click") {
    assertRatio(collection.advance.xRatio, "workflow.collection.advance.xRatio");
    assertRatio(collection.advance.yRatio, "workflow.collection.advance.yRatio");
  }
  if (collection.advance.mode === "agent" && !String(collection.advance.goal || "").trim()) {
    throw new Error("workflow.collection.advance.goal is required for agent mode.");
  }
  if (collection.advance.mode !== "agent" && collection.advance.allowedKeys != null) {
    throw new Error("workflow.collection.advance.allowedKeys is supported only for agent mode.");
  }
  if (collection.advance.allowedKeys != null && !Array.isArray(collection.advance.allowedKeys)) {
    throw new Error("workflow.collection.advance.allowedKeys must be an array.");
  }
  for (const key of collection.advance.allowedKeys || []) {
    if (!SAFE_KEYS.has(String(key).toUpperCase())) {
      throw new Error(`workflow.collection.advance allows unsupported key: ${key}`);
    }
  }
  if (collection.advance.maxSteps != null && (!Number.isInteger(collection.advance.maxSteps) || collection.advance.maxSteps < 1 || collection.advance.maxSteps > 10)) {
    throw new Error("workflow.collection.advance.maxSteps must be an integer from 1 through 10.");
  }
  if (collection.advance.waitMs != null && (!Number.isInteger(collection.advance.waitMs) || collection.advance.waitMs < 0 || collection.advance.waitMs > 60_000)) {
    throw new Error("workflow.collection.advance.waitMs must be between 0 and 60000.");
  }

  if (workflow.browser != null) {
    assertObject(workflow.browser, "workflow.browser");
    if (workflow.browser.fullscreen != null && typeof workflow.browser.fullscreen !== "boolean") {
      throw new Error("workflow.browser.fullscreen must be a boolean.");
    }
    if (workflow.browser.launchWaitMs != null && (!Number.isInteger(workflow.browser.launchWaitMs) || workflow.browser.launchWaitMs < 0 || workflow.browser.launchWaitMs > 60_000)) {
      throw new Error("workflow.browser.launchWaitMs must be between 0 and 60000.");
    }
  }

  return workflow;
}

export async function loadWorkflow({ preset, workflowPath }) {
  if (preset && workflowPath) throw new Error("Use either --preset or --workflow, not both.");
  if (!preset && !workflowPath) throw new Error("Use --preset NAME or --workflow PATH.");

  const resolvedPath = preset
    ? path.join(presetsDir, `${preset}.json`)
    : path.resolve(workflowPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const workflow = JSON.parse(raw);
  validateWorkflow(workflow);
  return { workflow, path: resolvedPath };
}

export async function listPresets() {
  const files = (await fs.readdir(presetsDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (name) => {
      const fullPath = path.join(presetsDir, name);
      const workflow = validateWorkflow(JSON.parse(await fs.readFile(fullPath, "utf8")));
      return { name: workflow.name, description: workflow.description || "", path: fullPath };
    }),
  );
}
