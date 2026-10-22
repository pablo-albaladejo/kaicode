#!/usr/bin/env node
// gateway-models [--out file]: the models this account can use on LLM Gateway, from its /v1/models endpoint, with
// prices as the gateway reports them. The key comes from ~/.aircode/config.json (harness.llm_keys.llmgateway) or
// $ANTHROPIC_AUTH_TOKEN and is never printed. Writes the raw answer to --out when given.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
let key = process.env.LLMGATEWAY_KEY || "";
try { key = key || JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {}
key = key || process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!key) { console.error("gateway-models: no LLM Gateway key (~/.aircode/config.json harness.llm_keys.llmgateway)"); process.exit(1); }
const base = (process.env.LLMGATEWAY_URL || "https://api.llmgateway.io").replace(/\/$/, "");
const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
const t = await r.text(); if (!r.ok) { console.error(`GET /v1/models → HTTP ${r.status}: ${t.slice(0, 300)}`); process.exit(1); }
const j = JSON.parse(t); const oi = process.argv.indexOf("--out"); if (oi > 0) fs.writeFileSync(process.argv[oi + 1], JSON.stringify(j, null, 2));
const list = j.data || j.models || j;
console.log(`${list.length} models · ${new Date().toISOString()}`);
for (const m of list) {
  const p = m.pricing || {}; const num = (v) => (v == null ? "" : Number(v) < 0.01 ? `$${(Number(v) * 1e6).toFixed(2)}` : `$${Number(v).toFixed(2)}`);
  console.log([m.id, m.name && m.name !== m.id ? `(${m.name})` : "", `in ${num(p.prompt ?? p.input)}`, `out ${num(p.completion ?? p.output)}`, m.context_length ? `ctx ${m.context_length}` : "", m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : ""].filter(Boolean).join("  "));
}
