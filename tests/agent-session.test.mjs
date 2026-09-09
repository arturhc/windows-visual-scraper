import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCropBox, parseRatioPair, validateAgentAction } from "../scripts/lib/agent-session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("package has no AI SDK runtime dependency", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies, undefined);
  const entrypoint = await fs.readFile(path.join(root, "scripts", "image-scraper.mjs"), "utf8");
  assert.doesNotMatch(entrypoint, /from ["']openai["']/);
});
