import path from "node:path";

export function parseCli(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    if (token.startsWith("--no-")) {
      options[token.slice(5)] = false;
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (next != null && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { command, options };
}

export function readBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

export function readInteger(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Expected an integer, received: ${value}`);
  return Math.min(max, Math.max(min, parsed));
}

export function readNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received: ${value}`);
  return Math.min(max, Math.max(min, parsed));
}

export function requireOption(options, key) {
  const value = options[key];
  if (value == null || value === true || String(value).trim() === "") {
    throw new Error(`Missing required option --${key}`);
  }
  return String(value).trim();
}

export function resolveOutputDir(options) {
  const configured = typeof options.output === "string" ? options.output : "image-scraper-output";
  return path.resolve(configured);
}

export function assertHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`Only http and https URLs are supported: ${value}`);
  }
  return url.toString();
}

export function assertLiveUiAuthorized(options) {
  if (!readBoolean(options["confirm-live-ui"], false)) {
    throw new Error(
      "Live Windows UI automation requires --confirm-live-ui. Use --dry-run to validate without opening Edge.",
    );
  }
}

export function assertEdgeProfile(value) {
  const profile = String(value || "Default").trim();
  if (!/^[\p{L}\p{N} ._-]{1,80}$/u.test(profile)) {
    throw new Error("Edge profile names may contain only letters, numbers, spaces, dots, underscores, and hyphens.");
  }
  return profile;
}
