import fs from "node:fs/promises";

function pngDimensions(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]).has(marker)) {
      return { format: "jpeg", width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const kind = bytes.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    return {
      format: "webp",
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8 " && bytes.length >= 30) {
    return { format: "webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function dimensionsFromBytes(bytes) {
  const dimensions = pngDimensions(bytes) || jpegDimensions(bytes) || webpDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error("Could not determine PNG, JPEG, or WebP image dimensions.");
  }
  return {
    ...dimensions,
    aspectRatio: Number((dimensions.width / dimensions.height).toFixed(4)),
  };
}

export async function readImageMetadata(filePath) {
  return dimensionsFromBytes(await fs.readFile(filePath));
}
