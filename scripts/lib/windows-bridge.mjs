import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const helperPath = path.resolve(moduleDir, "..", "windows", "browser-window-tools.ps1");

function toPowerShellName(key) {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export async function invokeWindows(action, parameters = {}, { expectJson = true } = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath, "-Action", action];
  for (const [key, value] of Object.entries(parameters)) {
    if (value == null || value === "") continue;
    args.push(`-${toPowerShellName(key)}`, String(value));
  }

  const { stdout, stderr } = await execFile("powershell.exe", args, {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stderr?.trim()) throw new Error(stderr.trim());
  const output = stdout.trim();
  if (!expectJson || !output) return output || null;
  return JSON.parse(output.replace(/[\u0000-\u001f\u007f]+/g, " ").trim());
}

export const windowsBrowser = {
  doctor: () => invokeWindows("doctor"),
  listWindows: async () => {
    const value = await invokeWindows("list-edge-windows");
    return Array.isArray(value) ? value : value ? [value] : [];
  },
  open: (url, profile) => invokeWindows("open-edge", { url, profile }),
  focus: (windowInfo) => invokeWindows("focus-window", {
    handle: windowInfo.handle,
    processId: windowInfo.processId,
  }, { expectJson: false }),
  maximize: (windowInfo) => invokeWindows("maximize-window", {
    handle: windowInfo.handle,
    processId: windowInfo.processId,
  }, { expectJson: false }),
  rect: (windowInfo) => invokeWindows("get-window-rect", { handle: windowInfo.handle }),
  key: (windowInfo, key, repeat = 1) => invokeWindows("send-key", {
    handle: windowInfo.handle,
    processId: windowInfo.processId,
    key,
    repeat,
  }, { expectJson: false }),
  click: (windowInfo, x, y, clickCount = 1) => invokeWindows("click-window", {
    handle: windowInfo.handle,
    processId: windowInfo.processId,
    x,
    y,
    clickCount,
  }, { expectJson: false }),
  screenshot: (windowInfo, outputPath) => invokeWindows("capture-window", {
    handle: windowInfo.handle,
    outputPath,
  }, { expectJson: false }),
  cropRatios: (inputPath, outputPath, cropBox, padding = 0) => invokeWindows("crop-photo-ratios", {
    inputPath,
    outputPath,
    cropLeftRatio: cropBox.leftRatio,
    cropTopRatio: cropBox.topRatio,
    cropRightRatio: cropBox.rightRatio,
    cropBottomRatio: cropBox.bottomRatio,
    cropPadding: padding,
  }, { expectJson: false }),
  cropHeuristic: (inputPath, outputPath, searchRightRatio = 0.82, padding = 8) =>
    invokeWindows("crop-photo", {
      inputPath,
      outputPath,
      searchRightRatio,
      cropPadding: padding,
    }, { expectJson: false }),
  close: (windowInfo) => invokeWindows("close-window", {
    handle: windowInfo.handle,
    processId: windowInfo.processId,
  }, { expectJson: false }),
};

export async function waitForCreatedEdgeWindow(beforeWindows, launchInfo, expectedHost, timeoutMs = 30_000) {
  const previousHandles = new Set(beforeWindows.map((entry) => String(entry.handle)));
  const deadline = Date.now() + timeoutMs;
  const preferRelevantTitleUntil = Date.now() + Math.min(5_000, timeoutMs);
  const titleHint = expectedHost.includes("instagram")
    ? "instagram"
    : expectedHost.includes("facebook")
      ? "facebook"
      : "";
  let fallback = null;

  while (Date.now() < deadline) {
    const current = await windowsBrowser.listWindows();
    const created = current.filter((entry) => !previousHandles.has(String(entry.handle)));
    const processWindow = created.find((entry) => entry.processId === launchInfo.processId);
    const titledWindow = created.find((entry) =>
      titleHint ? String(entry.title || "").toLowerCase().includes(titleHint) : true,
    );
    if (processWindow && (!titleHint || String(processWindow.title || "").toLowerCase().includes(titleHint))) {
      return processWindow;
    }
    if (titledWindow) return titledWindow;
    fallback = processWindow || created.at(-1) || fallback;
    if (fallback && Date.now() >= preferRelevantTitleUntil) return fallback;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (fallback) return fallback;
  throw new Error("Could not identify the Edge window created for this run.");
}
