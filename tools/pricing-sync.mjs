#!/usr/bin/env node
// pricing-sync <gateway-models.json>: refreshes ~/.claude/pricing.json from the LLM Gateway catalogue (tools/gateway-models.mjs
// --out). Adds new models, updates changed prices, keeps entries the gateway no longer lists (old sessions still need
// them to be priced) and the Anthropic-direct ones used by the claude-anthropic profile. Backup first.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const src = process.argv[2]; if (!src) { console.error("usage: pricing-sync <gateway-models.json>"); process.exit(1); }
const F = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "pricing.json");
const cur = JSON.parse(fs.readFileSync(F, "utf8")), cat = JSON.parse(fs.readFileSync(src, "utf8")); const list = cat.data || cat;
const M = (v) => Math.round(Number(v || 0) * 1e6 * 10000) / 10000;
const entry = (p, provider) => { const input = M(p.prompt), cw = M(p.input_cache_write);
  return { input, output: M(p.completion), cacheRead: M(p.input_cache_read), cacheWrite: cw || (provider === "anthropic" ? Math.round(input * 1.25 * 10000) / 10000 : input) }; };
const changed = [], added = [];
const put = (k, e) => { const o = cur[k]; if (!o) { added.push(k); cur[k] = e; return; } if (["input", "output", "cacheRead"].some((x) => Math.abs((o[x] ?? 0) - e[x]) > 1e-6)) { changed.push(`${k}: ${o.input}/${o.output} → ${e.input}/${e.output}`); cur[k] = { ...o, ...e }; } };
for (const m of list) {
  if (!m.pricing || (Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)) continue;   // media, search, free
  put(m.id, entry(m.pricing, m.family));
  for (const pr of m.providers || []) if (pr.pricing) put(`${pr.providerId}/${m.id}`, entry(pr.pricing, pr.providerId));
}
cur._source = `USD per 1M tokens. LLM Gateway catalogue (/v1/models) synced ${new Date().toISOString().slice(0, 10)} by pricing-sync; entries the gateway no longer lists are kept for old sessions. Keys: '<provider>/<model>' and bare '<model>'. Anthropic cacheWrite = 1.25x input. Lookup order in cc-cost/statusline: exact → without date/[1m] suffix → without provider prefix.`;
fs.copyFileSync(F, `${F}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.writeFileSync(F, JSON.stringify(cur, null, 2) + "\n");
console.log(`pricing.json: ${added.length} added, ${changed.length} changed`); for (const c of changed) console.log("  ~ " + c);
console.log("  + " + added.filter((k) => !k.includes("/")).join(", "));
