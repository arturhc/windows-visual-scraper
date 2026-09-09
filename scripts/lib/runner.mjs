import path from "node:path";
import { createRunArtifacts, sha256File } from "./artifacts.mjs";
import { closeBrowserSession, openBrowserSession, sleep } from "./browser-session.mjs";
import { windowsBrowser } from "./windows-bridge.mjs";

const portable = (root, target) => path.relative(root, target).replaceAll("\\", "/");

export async function capturePage({ url, outputDir, shots, stepPages, options }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const artifacts = await createRunArtifacts(outputDir, `page-${host}`, {
    kind: "page-capture",
    url,
    requestedCount: shots,
  });
  let session;
  let terminalError;

  try {
    session = await openBrowserSession(url, options);
    if (options.resetScroll !== false) {
      await windowsBrowser.key(session.target, "HOME");
      await sleep(options.waitMs ?? 1_200);
    }

    for (let index = 1; index <= shots; index += 1) {
      const filePath = path.join(artifacts.directories.screenshots, `viewport-${String(index).padStart(3, "0")}.png`);
      await windowsBrowser.screenshot(session.target, filePath);
      artifacts.manifest.items.push({
        index,
        path: portable(artifacts.directories.root, filePath),
        sha256: await sha256File(filePath),
      });
      await artifacts.log("viewport-captured", { index, path: filePath });
      await artifacts.writeManifest();
      if (index < shots && stepPages > 0) {
        await windowsBrowser.key(session.target, "PGDN", stepPages);
        await sleep(options.waitMs ?? 1_200);
      }
    }
    await artifacts.writeManifest({ status: "complete", finishedAt: new Date().toISOString() });
  } catch (error) {
    terminalError = error;
    await artifacts.log("run-error", { message: error.message, stack: error.stack });
    await artifacts.writeManifest({
      status: artifacts.manifest.items.length ? "partial" : "failed",
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
  } finally {
    await closeBrowserSession(session, options, artifacts.log);
  }

  if (terminalError) {
    terminalError.manifestPath = artifacts.manifestPath;
    throw terminalError;
  }
  return { manifest: artifacts.manifest, manifestPath: artifacts.manifestPath, root: artifacts.directories.root };
}
