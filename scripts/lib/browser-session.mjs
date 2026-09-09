import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { windowsBrowser, waitForCreatedEdgeWindow } from "./windows-bridge.mjs";

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function pauseForUser(message) {
  const terminal = readline.createInterface({ input, output });
  try {
    await terminal.question(`${message}\nPress Enter to continue... `);
  } finally {
    terminal.close();
  }
}

export async function openBrowserSession(url, options = {}) {
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

export async function closeBrowserSession(session, options = {}, log = async () => {}) {
  const target = session?.target || session?.window;
  if (!target) return;

  try {
    if (session.fullscreen) {
      await windowsBrowser.key(target, "F11");
      await sleep(250);
    }
  } catch (error) {
    await log("cleanup-warning", { message: `Could not leave fullscreen: ${error.message}` });
  }

  if (!options.keepOpen) {
    try {
      await windowsBrowser.close(target);
    } catch (error) {
      await log("cleanup-warning", { message: `Could not close Edge window: ${error.message}` });
    }
  }
}
