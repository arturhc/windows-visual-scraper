import test from "node:test";
import assert from "node:assert/strict";
import { dHashFromGrayPixels, deduplicateFrameRecords, hammingDistanceHex } from "../scripts/lib/media-tools.mjs";

test("perceptual hashes remove near-identical frames without dropping meaningful changes", () => {
  const flat = Buffer.alloc(72, 50);
  const descending = Buffer.from(Array.from({ length: 72 }, (_, index) => 255 - index));
  const flatHash = dHashFromGrayPixels(flat);
  const descendingHash = dHashFromGrayPixels(descending);
  assert.equal(flatHash, "0000000000000000");
  assert.ok(hammingDistanceHex(flatHash, descendingHash) > 6);
  const result = deduplicateFrameRecords([
    { path: "a.jpg", sha256: "a", perceptualHash: flatHash, meanColor: [200, 20, 20] },
    { path: "a-copy.jpg", sha256: "other", perceptualHash: flatHash, meanColor: [201, 20, 19] },
    { path: "different-color.jpg", sha256: "color", perceptualHash: flatHash, meanColor: [20, 20, 200] },
    { path: "b.jpg", sha256: "b", perceptualHash: descendingHash, meanColor: [100, 100, 100] },
  ], 6);
  assert.deepEqual(result.kept.map((item) => item.path), ["a.jpg", "different-color.jpg", "b.jpg"]);
  assert.equal(result.rejected[0].reason, "perceptual-duplicate");
});
