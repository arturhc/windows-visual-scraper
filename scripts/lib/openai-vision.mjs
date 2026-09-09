import fs from "node:fs/promises";
import OpenAI from "openai";

const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "xRatio", "yRatio", "key", "waitMs", "reason"],
  properties: {
    type: { type: "string", enum: ["click", "key", "wait", "done"] },
    xRatio: { type: ["number", "null"], minimum: 0, maximum: 1 },
    yRatio: { type: ["number", "null"], minimum: 0, maximum: 1 },
    key: { type: ["string", "null"], enum: ["HOME", "END", "PGDN", "LEFT", "RIGHT", "ESC", "ENTER", "SPACE", "F11", null] },
    waitMs: { type: "integer", minimum: 0, maximum: 60000 },
    reason: { type: "string" },
  },
};

const INSPECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["viewerOpen", "accept", "mediaType", "cropFound", "crop", "confidence", "reason"],
  properties: {
    viewerOpen: { type: "boolean" },
    accept: { type: "boolean" },
    mediaType: { type: "string", enum: ["still-image", "video", "unknown"] },
    cropFound: { type: "boolean" },
    crop: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["leftRatio", "topRatio", "rightRatio", "bottomRatio"],
      properties: {
        leftRatio: { type: "number", minimum: 0, maximum: 1 },
        topRatio: { type: "number", minimum: 0, maximum: 1 },
        rightRatio: { type: "number", minimum: 0, maximum: 1 },
        bottomRatio: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
};

function normalizeCrop(crop) {
  if (!crop) return null;
  const values = [crop.leftRatio, crop.topRatio, crop.rightRatio, crop.bottomRatio];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  if (crop.rightRatio - crop.leftRatio < 0.03 || crop.bottomRatio - crop.topRatio < 0.03) return null;
  return crop;
}

export function createVisionClient(config) {
  if (!config.apiKey) throw new Error("OPENAI_API_KEY is required for visual inspection.");
  const client = new OpenAI({ apiKey: config.apiKey, organization: config.organization });

  async function requestJson(imagePath, prompt, schemaName, schema) {
    const data = await fs.readFile(imagePath);
    const inputImage = `data:image/png;base64,${data.toString("base64")}`;
    const request = {
      model: config.model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: inputImage, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
      max_output_tokens: config.maxOutputTokens,
    };
    if (config.reasoning !== "none") request.reasoning = { effort: config.reasoning };
    const response = await client.responses.create(request);
    if (!response.output_text) throw new Error("The visual model returned no structured output.");
    return JSON.parse(response.output_text);
  }

  return {
    async decideAction(imagePath, stage, step) {
      const allowedTypes = stage.allowedActionTypes.join(", ");
      const allowedKeys = (stage.allowedKeys || []).join(", ") || "none";
      return requestJson(
        imagePath,
        `You control only the visible Microsoft Edge window in this screenshot.\nGoal: ${stage.goal}\nGuidance: ${stage.guidance || "None."}\nStep: ${step}/${stage.maxSteps}.\nAllowed action types: ${allowedTypes}. Allowed keys: ${allowedKeys}.\nReturn done only when the goal is visibly satisfied. For click, target the center of the intended control using window-relative ratios. Never click account, privacy, purchase, checkout, message, delete, upload, consent-change, or browser navigation controls.`,
        "visible_ui_action",
        ACTION_SCHEMA,
      );
    },

    async inspectFrame(imagePath, inspectionPrompt) {
      const result = await requestJson(
        imagePath,
        `Inspect this visible browser screenshot for image extraction. ${inspectionPrompt}\nAccept only a genuine still image that meets the instruction. Reject videos, reels, grids, feeds, loading states, ads, placeholders, and ambiguous frames. If accepted, provide a tight crop around the image pixels only, excluding browser chrome, captions, comments, buttons, borders, and backdrop.`,
        "visible_media_inspection",
        INSPECTION_SCHEMA,
      );
      result.crop = result.cropFound ? normalizeCrop(result.crop) : null;
      if (!result.crop) result.cropFound = false;
      return result;
    },

    async refineCrop(imagePath) {
      const result = await requestJson(
        imagePath,
        "This image is a candidate crop. Accept it if it predominantly contains one still image. If surrounding browser UI, comments, backdrop, or borders remain, return a tighter crop around only the actual image pixels. Use cropFound=false when no meaningful safe reduction is needed.",
        "refined_media_crop",
        INSPECTION_SCHEMA,
      );
      return result.cropFound ? normalizeCrop(result.crop) : null;
    },
  };
}
