const ALLOWED_REASONING = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function hasOpenAiKey() {
  const key = process.env.OPENAI_API_KEY || "";
  return key.startsWith("sk-") && !key.includes("REPLACE_WITH");
}

export function resolveVisionConfig(options = {}) {
  const reasoning = String(
    options.reasoning || process.env.WINDOWS_IMAGE_SCRAPER_REASONING || "medium",
  ).toLowerCase();
  if (!ALLOWED_REASONING.has(reasoning)) {
    throw new Error(`Unsupported reasoning effort: ${reasoning}`);
  }

  const rawTokens = Number(
    process.env.WINDOWS_IMAGE_SCRAPER_MAX_OUTPUT_TOKENS || 900,
  );

  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    organization: process.env.OPENAI_ORGANIZATION_ID || undefined,
    model:
      options.model ||
      process.env.WINDOWS_IMAGE_SCRAPER_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.4-mini",
    reasoning,
    maxOutputTokens: Number.isFinite(rawTokens)
      ? Math.min(4_000, Math.max(300, rawTokens))
      : 900,
  };
}
