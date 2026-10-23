#!/usr/bin/env node
// image-probe <image> <model>…: sends one image through LLM Gateway's Anthropic endpoint and reports the input tokens it
// costs, to see whether a model gets images as images (about 1.5k tokens) or as text (hundreds of thousands).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const [img, ...models] = process.argv.slice(2);
let key = ""; try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {}
const data = fs.readFileSync(img).toString("base64"), media = img.endsWith(".png") ? "image/png" : "image/jpeg";
for (const model of models) {
  const r = await fetch("https://api.llmgateway.io/v1/messages", { method: "POST", headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 80, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media, data } }, { type: "text", text: "In one sentence, what does this screenshot show?" }] }] }) });
  const j = await r.json().catch(() => ({}));
  console.log(`${model}: HTTP ${r.status} · input_tokens ${j.usage?.input_tokens ?? "?"} · ${(j.content?.[0]?.text || j.error?.message || JSON.stringify(j)).slice(0, 160)}`);
}
