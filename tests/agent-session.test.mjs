import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeContextId,
  completeWorkflowStage,
  deriveTargetLabel,
  inferPlatform,
  normalizeSavedImageMetadata,
  parseCropBox,
  parseRatioPair,
  saveAgentFrame,
  loadAgentSession,
  validateAgentAction,
} from "../scripts/lib/agent-session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function testPng(width = 100, height = 60) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("ratio parsers accept normalized coordinates and reject invalid crops", () => {
  assert.deepEqual(parseRatioPair("0.25,0.75"), { xRatio: 0.25, yRatio: 0.75 });
  assert.deepEqual(parseCropBox("0.1,0.2,0.8,0.9"), {
    leftRatio: 0.1,
    topRatio: 0.2,
    rightRatio: 0.8,
    bottomRatio: 0.9,
  });
  assert.throws(() => parseRatioPair("2,0.5"), /0 through 1/);
  assert.throws(() => parseCropBox("0.8,0.2,0.1,0.9"), /greater/);
});

test("agent actions are bounded by workflow context", () => {
  const context = {
    id: "open-viewer",
    allowedActionTypes: ["click", "key", "done"],
    allowedKeys: ["ENTER"],
    maxSteps: 2,
  };
  assert.deepEqual(validateAgentAction(context, { type: "click", xRatio: 0.2, yRatio: 0.7 }, 0), {
    type: "click",
    xRatio: 0.2,
    yRatio: 0.7,
  });
  assert.throws(() => validateAgentAction(context, { type: "key", key: "F11" }, 0), /not allowed/);
  assert.throws(() => validateAgentAction(context, { type: "done" }, 2), /step limit/);
});

test("done advances through workflow stages into collection context", () => {
  const session = {
    workflow: { stages: [{ id: "first" }, { id: "second" }] },
    currentStageIndex: 0,
    completedStages: [],
  };
  assert.equal(activeContextId(session), "first");
  assert.equal(completeWorkflowStage(session, "first"), "second");
  assert.equal(completeWorkflowStage(session, "second"), "collection");
  assert.deepEqual(session.completedStages, ["first", "second"]);
  assert.throws(() => completeWorkflowStage(session, "second"), /active context is "collection"/);
});

test("loading reconciles an active session with a failed manifest", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-reconcile-test-"));
  try {
    const sessionPath = path.join(runRoot, "session.json");
    const manifestPath = path.join(runRoot, "manifest.json");
    const tracePath = path.join(runRoot, "run.ndjson");
    await fs.writeFile(manifestPath, JSON.stringify({ status: "failed", finishedAt: "2026-09-10T00:00:00.000Z", error: "capture failed", items: [], rejectedFrames: [] }));
    await fs.writeFile(tracePath, "");
    await fs.writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      kind: "agent-native",
      status: "active",
      runRoot,
      manifestPath,
      tracePath,
      sessionPath,
      workflow: { stages: [] },
    }));
    await assert.rejects(() => loadAgentSession(sessionPath, { active: true }), /status: failed/);
    const repaired = JSON.parse(await fs.readFile(sessionPath, "utf8"));
    assert.equal(repaired.status, "failed");
    assert.equal(repaired.error, "capture failed");
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
});

test("package has no AI SDK runtime dependency", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies, undefined);
  const entrypoint = await fs.readFile(path.join(root, "scripts", "image-scraper.mjs"), "utf8");
  assert.doesNotMatch(entrypoint, /from ["']openai["']/);
});

test("social targets and descriptive image metadata are normalized", () => {
  assert.equal(inferPlatform("https://www.instagram.com/example/"), "instagram");
  assert.equal(inferPlatform("https://facebook.com/example/photos"), "facebook");
  assert.equal(deriveTargetLabel("https://www.instagram.com/example/"), "example");
  assert.deepEqual(normalizeSavedImageMetadata({
    name: "Sunset toast by the sea",
    description: "Three friends raise glasses in front of an orange sunset.",
    whatsappRating: "5",
    whatsappReason: "Clear, warm, and easy to understand on a phone.",
    tags: ["sunset", "friends"],
  }), {
    displayName: "Sunset toast by the sea",
    fileStem: "sunset-toast-by-the-sea",
    description: "Three friends raise glasses in front of an orange sunset.",
    tags: ["sunset", "friends"],
    whatsapp: { rating: 5, recommended: true, reason: "Clear, warm, and easy to understand on a phone." },
  });
  assert.throws(() => normalizeSavedImageMetadata({
    name: "image-001",
    description: "A generic image description.",
    whatsappRating: 3,
    whatsappReason: "Too generic.",
  }), /generic names/);
});

test("save writes a descriptively named item and editorial metadata", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-save-test-"));
  try {
    const directories = {
      root: runRoot,
      screenshots: path.join(runRoot, "screenshots"),
      media: path.join(runRoot, "media"),
      raw: path.join(runRoot, "raw"),
      trace: path.join(runRoot, "trace"),
    };
    await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
    const inputPath = path.join(directories.screenshots, "frame.png");
    const manifestPath = path.join(runRoot, "manifest.json");
    const tracePath = path.join(runRoot, "run.ndjson");
    const sessionPath = path.join(runRoot, "session.json");
    await fs.writeFile(inputPath, testPng());
    await fs.writeFile(tracePath, "");
    await fs.writeFile(manifestPath, JSON.stringify({ status: "running", items: [], rejectedFrames: [] }));
    await fs.writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      kind: "agent-native",
      status: "active",
      runRoot,
      directories,
      manifestPath,
      tracePath,
      sessionPath,
      requestedCount: 1,
      workflow: { collection: { crop: { mode: "none" } } },
      counters: { shots: 1, actions: 0, saves: 0, rejections: 0 },
      contextActions: {},
    }));

    const result = await saveAgentFrame({
      sessionValue: sessionPath,
      inputPath,
      method: "full-window",
      metadata: {
        name: "orange sunset over calm water",
        description: "An orange sunset reflects across calm water beneath dark clouds.",
        whatsappRating: 4,
        whatsappReason: "Clear subject and a strong peaceful mood.",
      },
    });
    assert.match(result.imagePath, /001-orange-sunset-over-calm-water\.png$/);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.items[0].whatsapp.rating, 4);
    assert.equal(manifest.items[0].displayName, "orange sunset over calm water");
    assert.equal(manifest.items[0].width, 100);
    assert.equal(manifest.items[0].analysis.status, "basic");
    await fs.access(path.join(runRoot, manifest.items[0].analysis.path));
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
});
