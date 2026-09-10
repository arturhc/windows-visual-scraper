import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeImageAsset, backfillImageKnowledge } from "../scripts/lib/backfill.mjs";

function testPng(width = 160, height = 90) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const detailedAnalysis = {
  confidence: "high",
  summary: "Producto cosmético sobre una mesa clara con luz lateral cálida.",
  detailedVisualDescription: "Un frasco cosmético ocupa el centro de una mesa clara. La luz lateral crea una sombra suave; el fondo neutro y desenfocado mantiene toda la atención sobre el empaque.",
  purpose: "Presentación de producto orientada a branding y consideración.",
  messageAndIntent: "Comunica cuidado, sencillez y una experiencia de uso premium sin recurrir a una promoción agresiva.",
  composition: "Encuadre cerrado, producto centrado, jerarquía directa y espacio negativo alrededor del frasco.",
  lighting: "Aparenta luz lateral cálida y suave; la fuente exacta no puede confirmarse.",
  cameraPhotography: "Toma de producto cercana con profundidad de campo reducida aparente; lente y cámara desconocidos.",
  artDirection: "Superficie clara, fondo doméstico minimalista y estilismo limpio.",
  graphicDesignTypography: "La etiqueta funciona como único elemento tipográfico visible; la familia exacta no es identificable.",
  colorTreatment: "Paleta crema y ámbar, contraste moderado y temperatura cálida.",
  effectiveness: "El aislamiento visual hace que el producto sea reconocible incluso en tamaño pequeño.",
  reusableElements: ["Mostrar el producto en contexto de uso", "Usar luz lateral suave"],
  nonEssentialElements: ["El color exacto de la mesa", "La marca específica del frasco"],
  recreationRecipe: "Fotografiar otro producto sobre una superficie distinta, conservando el encuadre limpio, la luz lateral y el espacio negativo.",
  generationPrompts: ["Fotografía editorial original de un producto distinto, luz lateral cálida, fondo minimalista y composición limpia."],
  variations: ["Cambiar a una paleta fría", "Introducir una mano usando el producto"],
  observations: "No se infiere equipo específico.",
  observed: ["Un frasco sobre una mesa clara"],
  inferred: ["La pieza parece orientada a posicionamiento premium"],
  unknown: ["Cámara, lente y fuente luminosa exactas"],
};

test("backfill creates mandatory twin Markdown, manifest fields, and navigable indexes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-backfill-test-"));
  try {
    const run = path.join(root, "instagram-example", "001");
    await fs.mkdir(path.join(run, "media"), { recursive: true });
    const imagePath = path.join(run, "media", "001-producto-sobre-mesa.png");
    await fs.writeFile(imagePath, testPng());
    const manifestPath = path.join(run, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      platform: "instagram",
      targetLabel: "example",
      url: "https://instagram.com/example/",
      startedAt: "2026-09-10T00:00:00.000Z",
      status: "complete",
      rejectedFrames: [],
      items: [{ index: 1, path: "media/001-producto-sobre-mesa.png", sha256: "abc", displayName: "producto sobre mesa", description: "Producto cosmético sobre una mesa clara." }],
    }));

    const result = await backfillImageKnowledge(root);
    assert.equal(result.created, 1);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.items[0].analysis.status, "basic");
    assert.equal(manifest.items[0].width, 160);
    const twinPath = path.join(run, manifest.items[0].analysis.path);
    assert.match(await fs.readFile(twinPath, "utf8"), /# Elementos reutilizables como inspiración/);
    await fs.access(path.join(root, "content-manifest.json"));
    const imageIndex = await fs.readFile(path.join(root, "reports", "images-index.md"), "utf8");
    assert.match(imageIndex, /URL original/);
    assert.match(imageIndex, /## Descartes/);
    assert.match(imageIndex, /## Errores/);

    const analyzed = await analyzeImageAsset({ rootValue: root, imagePath, analysis: detailedAnalysis });
    assert.equal(analyzed.status, "analyzed");
    const updated = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(updated.items[0].analysis.status, "analyzed");
    const markdown = await fs.readFile(twinPath, "utf8");
    assert.match(markdown, /Mostrar el producto en contexto de uso/);
    assert.match(markdown, /## Inferido/);

    const rerun = await backfillImageKnowledge(root);
    assert.equal(rerun.created, 0);
    assert.equal(rerun.skipped, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
