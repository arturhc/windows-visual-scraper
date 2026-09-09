import test from "node:test";
import assert from "node:assert/strict";
import { listPresets, validateWorkflow } from "../scripts/lib/workflow-schema.mjs";

test("all bundled workflows validate", async () => {
  const presets = await listPresets();
  assert.deepEqual(presets.map((entry) => entry.name), ["facebook-photos", "generic-lightbox-gallery", "instagram-photo-posts"]);
});

test("workflow schema rejects arbitrary actions and unsafe keys", () => {
  const base = {
    version: 2,
    name: "bad-flow",
    stages: [{ id: "bad-stage", goal: "test", allowedActionTypes: ["shell"], allowedKeys: [], maxSteps: 1 }],
    collection: {
      defaultCount: 1,
      maxCount: 1,
      maxAttemptsPerItem: 1,
      inspectionPrompt: "accept a still image",
      crop: { mode: "none" },
      advance: { mode: "key", key: "CTRL+L" }
    }
  };
  assert.throws(() => validateWorkflow(base), /unsupported action/);
  base.stages[0].allowedActionTypes = ["done"];
  assert.throws(() => validateWorkflow(base), /Unsupported advance key/);
});
