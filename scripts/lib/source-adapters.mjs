const ADAPTERS = {
  website: {
    id: "website",
    platforms: ["web"],
    imageAcquisition: ["visual-gallery", "direct-image"],
    videoAcquisition: ["direct-video", "local-file"],
  },
  instagram: {
    id: "instagram",
    platforms: ["instagram"],
    imageAcquisition: ["visual-edge"],
    videoAcquisition: ["direct-video", "local-file"],
  },
  facebook: {
    id: "facebook",
    platforms: ["facebook"],
    imageAcquisition: ["visual-edge"],
    videoAcquisition: ["direct-video", "local-file"],
  },
};

export function inferSourcePlatform(urlValue) {
  const host = new URL(urlValue).hostname.toLowerCase();
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com")) return "facebook";
  return "web";
}

export function resolveSourceAdapter({ platform, url } = {}) {
  const resolvedPlatform = String(platform || (url ? inferSourcePlatform(url) : "web")).toLowerCase();
  const adapter = Object.values(ADAPTERS).find((candidate) => candidate.platforms.includes(resolvedPlatform));
  if (!adapter) throw new Error(`No source adapter is registered for platform: ${resolvedPlatform}.`);
  return { ...adapter, platform: resolvedPlatform };
}

export function listSourceAdapters() {
  return Object.values(ADAPTERS).map((adapter) => ({ ...adapter }));
}
