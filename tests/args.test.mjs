import test from "node:test";
import assert from "node:assert/strict";
import { assertEdgeProfile, assertHttpUrl, assertLiveUiAuthorized, parseCli, readInteger } from "../scripts/lib/args.mjs";

test("parseCli supports values and negated flags", () => {
  assert.deepEqual(parseCli(["run", "--preset", "demo", "--no-trace", "--dry-run"]), {
    command: "run",
    options: { preset: "demo", trace: false, "dry-run": true },
  });
});

test("URL and live UI guards reject unsafe input", () => {
  assert.throws(() => assertHttpUrl("file:///secret"), /Only http and https/);
  assert.throws(() => assertLiveUiAuthorized({}), /confirm-live-ui/);
  assert.equal(readInteger("500", 1, { min: 1, max: 50 }), 50);
  assert.throws(() => readInteger("2x", 1), /Expected an integer/);
  assert.equal(assertEdgeProfile("Profile 1"), "Profile 1");
  assert.throws(() => assertEdgeProfile("Default\" --guest"), /profile names/);
});
