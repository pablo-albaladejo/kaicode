#!/usr/bin/env node
// model-probe <model>…: one tiny tool-use request per model through LLM Gateway's Anthropic endpoint (the way Claude
// Code calls it), to check a model is reachable for this key and handles tools before the router sends work to it.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
let key = ""; try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {}
key = key || process.env.ANTHROPIC_AUTH_TOKEN; if (!key) { console.error("no gateway key"); process.exit(1); }
const base = (process.env.LLMGATEWAY_URL || "https://api.llmgateway.io").replace(/\/$/, "");
const tool = { name: "count_files", description: "Count files in a folder", input_schema: { type: "object", properties: { folder: { type: "string" } }, required: ["folder"] } };
const effort = (process.argv.find((a) => a.startsWith("--effort=")) || "").split("=")[1];
for (const model of process.argv.slice(2).filter((m) => /^[\w./:-]+$/.test(m))) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 200, tools: [tool], ...(effort ? { output_config: { effort } } : {}), messages: [{ role: "user", content: "How many files are in the folder src? Use the tool." }] }) });
    const j = await r.json().catch(() => ({}));
    const used = (j.content || []).find((b) => b.type === "tool_use");
    console.log(`${model}${effort ? ` (effort ${effort})` : ""}: HTTP ${r.status} · ${Date.now() - t0} ms · ${used ? `tool_use ${used.name}(${JSON.stringify(used.input)})` : (j.error?.message || JSON.stringify(j).slice(0, 160))} · usage ${JSON.stringify(j.usage || {})}`);
  } catch (e) { console.log(`${model}: ${e.message}`); }
}
