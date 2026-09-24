#!/usr/bin/env node
// Model picker for Claude Code on the Aircall LLM Gateway.
//   cc-models                 list groups with prices (from ~/.claude/pricing.json)
//   cc-models --list          every gateway model with prices (from pricing.json), cheapest first: feeds `claude @pick`
//                             group = models.json group, or (price tier) when the model is not in the router table
//   cc-models --resolve X     print the model id for X: a group name (its first model),
//                             "group:N" (Nth model of the group, 1-based), an alias
//                             (opus/sonnet/haiku/fable) or a model id (printed as-is)
// Used by the `claude` wrapper:  claude @strong   claude @mid:2   claude @gpt-6-sol
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(CFG_DIR, f), "utf8")); } catch { return null; } };
const models = read("models.json"), prices = read("pricing.json") || {};
if (!models) { console.error(`models.json not found in ${CFG_DIR}`); process.exit(1); }

const bare = (m) => m.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "").split("/").pop();
const priceOf = (m) => prices[m] || prices[bare(m)] || null;
const money = (n) => "$" + (n < 1 ? n.toFixed(2) : n.toFixed(n % 1 ? 2 : 0));

const [flag, arg] = process.argv.slice(2);
if (flag === "--list") {
  const inGroup = new Map(); for (const [g, v] of Object.entries(models.groups || {})) for (const m of v.models) inGroup.set(bare(m), (inGroup.get(bare(m)) ? inGroup.get(bare(m)) + "," : "") + g);
  const rows = Object.entries(prices).filter(([k, v]) => typeof v === "object" && !k.includes("/") && !/-\d{8}$/.test(k)).sort((a, b) => a[1].output - b[1].output || a[1].input - b[1].input);
  // group: from models.json when curated; otherwise a price tier in parentheses (cheap < $2 out, mid $2-10, strong >= $10)
  const tier = (p) => (p.output < 2 ? "cheap" : p.output < 10 ? "mid" : "strong");
  for (const [id, p] of rows) console.log(`${id.padEnd(36)} ${money(p.input).padStart(6)} ${money(p.output).padStart(7)} ${money(p.cacheRead).padStart(6)}  ${inGroup.get(id) || "(" + tier(p) + ")"}`);
  process.exit(0);
}
if (flag === "--resolve") {
  if (!arg) { console.error("usage: cc-models --resolve <group|group:N|alias|model-id>"); process.exit(1); }
  const [name, idx] = arg.split(":");
  const g = models.groups?.[name];
  if (g) {
    const m = g.models[(Number(idx) || 1) - 1];
    if (!m) { console.error(`group "${name}" has ${g.models.length} models`); process.exit(1); }
    console.log(m); process.exit(0);
  }
  console.log(models.aliases?.[arg] || arg); process.exit(0);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`;
for (const [name, g] of Object.entries(models.groups || {})) {
  console.log(`\n${bold(name)}  ${dim(g.use || "")}`);
  g.models.forEach((m, i) => {
    const p = priceOf(m);
    const cost = p ? `${money(p.input).padStart(6)} in  ${money(p.output).padStart(6)} out  ${money(p.cacheRead).padStart(6)} cache` : dim("no price");
    console.log(`  ${String(i + 1).padStart(2)}. ${m.padEnd(34)} ${cost}${i === 0 ? dim("   (default: @" + name + ")") : ""}`);
  });
}
if (models.aliases) {
  console.log(`\n${bold("aliases")}  ${dim("what /model opus|sonnet|haiku|fable resolve to (from aircall-gateway.env)")}`);
  for (const [a, m] of Object.entries(models.aliases)) console.log(`  ${a.padEnd(8)} → ${m}`);
}
console.log(`\n${dim("Launch: claude @strong · claude @mid:3 · claude @gpt-6-sol     In session: /model <id>")}`);
