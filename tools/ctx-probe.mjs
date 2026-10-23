#!/usr/bin/env node
// ctx-probe <model> <k tokens>… [--max N]: sends a filler prompt of about N thousand tokens to find the context limit
// a model really has through LLM Gateway (the catalogue's context_length is not always the routed provider's).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
let key = ""; try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {}
const args = process.argv.slice(2), mi = args.indexOf("--max"), maxTok = mi >= 0 ? Number(args[mi + 1]) : 256; if (mi >= 0) args.splice(mi, 2);
const [model, ...sizes] = args;
for (const k of sizes.map(Number)) {
  const filler = "The quick brown fox jumps over the lazy dog near the river bank. ".repeat(Math.round(k * 1000 / 14));
  const r = await fetch("https://api.llmgateway.io/v1/messages", { method: "POST", headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTok, messages: [{ role: "user", content: filler + "\nReply with OK." }] }) });
  const j = await r.json().catch(() => ({}));
  console.log(`${model} ~${k}k tokens (max_tokens ${maxTok}): HTTP ${r.status} · input_tokens ${j.usage?.input_tokens ?? "-"} · ${(j.error?.message || j.content?.[0]?.text || "").slice(0, 140)}`);
}
