#!/usr/bin/env node
// bulk-read: let a cheap model read big files and answer a concrete question, so an expensive agent pays only
// for the answer. Companion of hooks/read-shunt.mjs (after Spotify's shunt plugin), through the Aircall gateway.
//   node ~/.claude/tools/bulk-read.mjs "<question>" <file|glob> [more files…] [--model <gateway id>] [--json]
// Output: structured bullets with file:line references. Files are wrapped in <file path=… lines=…> tags with
// line numbers so the reader can cite them. Total input is capped (shuntMaxChars, default 1.2M chars ≈ 300k tokens).
// Config in ~/.claude/router.json: shuntModel (default "fireworks/deepseek-v4.1-flash"), shuntMaxChars.
// Auth/URL: ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN from the session (the claude wrapper sets them),
// falling back to https://api.llmgateway.io and the key in ~/.aircode/config.json.
// Log: logs/read-shunt.jsonl (kind bulk-read: tokens, cost, ms) — shown by read-shunt --report and cc-cost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "read-shunt.jsonl");
const DEFAULTS = { shuntModel: "fireworks/deepseek-v4.1-flash", shuntMaxChars: 1_200_000, shuntTimeoutMs: 120_000, shuntAliases: ["pro", "sol", "opus"] };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}
let PRICES = {}; try { PRICES = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "pricing.json"), "utf8")); } catch {}
const priceFor = (m = "") => PRICES[m] || PRICES[m.split("/").pop()] || null;
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), kind: "bulk-read", ...o }) + "\n"); } catch {} };
const die = (m) => { console.error("bulk-read: " + m); process.exit(1); };

// ── args ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const model = opt("--model") || cfg.shuntModel;
const asJson = argv.includes("--json"); if (asJson) argv.splice(argv.indexOf("--json"), 1);
const [question, ...pats] = argv;
if (!question || !pats.length) die('usage: bulk-read "<question>" <file|glob> [more…] [--model id]');

// ── files (globs expanded with fs.globSync when available) ────────────
const files = [];
for (const p of pats) {
  let m = [];
  if (/[*?[{]/.test(p)) { try { m = fs.globSync ? fs.globSync(p, { cwd: process.cwd() }) : []; } catch {} }
  else m = [p];
  for (const f of m) { const abs = path.resolve(f); try { if (fs.statSync(abs).isFile()) files.push(abs); } catch { console.error(`bulk-read: skip ${f} (not a file)`); } }
}
if (!files.length) die("no readable files");
let total = 0; const parts = [];
for (const abs of files) {
  const text = fs.readFileSync(abs, "utf8");
  const rel = path.relative(process.cwd(), abs) || abs;
  const numbered = text.split("\n").map((l, i) => `${String(i + 1).padStart(5)}| ${l}`).join("\n");
  total += numbered.length;
  if (total > cfg.shuntMaxChars) die(`input exceeds ${cfg.shuntMaxChars} chars at ${rel}; ask a narrower question or fewer files`);
  parts.push(`<file path="${rel}" lines="${text.split("\n").length}">\n${numbered}\n</file>`);
}

// ── gateway call (Anthropic Messages API, the same endpoint Claude Code uses) ──
const base = (process.env.ANTHROPIC_BASE_URL || "https://api.llmgateway.io").replace(/\/$/, "");
let key = process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!key) { try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {} }
if (!key) die("no gateway key: ANTHROPIC_AUTH_TOKEN not set and ~/.aircode/config.json unreadable");
const system = `You read source files for another engineer who must not read them in full. Answer their question from the files only.
Rules: answer in structured bullets, concise, no preamble. Cite where things are as path:line (the line numbers are the "NNN|" prefixes). Quote short code fragments (≤ 3 lines) only when they are the answer. If the files do not contain the answer, say what is missing and where else to look (imports, names). Do not speculate beyond the code. End with one line "Read: <n> files, <n> lines".`;
const body = { model, max_tokens: 2500, temperature: 0.2, system, messages: [{ role: "user", content: `Question: ${question}\n\n${parts.join("\n\n")}` }] };
const t0 = Date.now();
let res, j;
try {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.shuntTimeoutMs);
  res = await fetch(`${base}/v1/messages`, { method: "POST", signal: ctl.signal, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", Authorization: `Bearer ${key}`, "x-api-key": key } });
  clearTimeout(timer);
  j = await res.json().catch(() => ({}));
} catch (e) { log({ error: e.name === "AbortError" ? "timeout" : String(e.message || e), model, files: files.map((f) => path.relative(process.cwd(), f)), question: question.slice(0, 200), ms: Date.now() - t0, cwd: process.cwd() }); die(e.name === "AbortError" ? `timeout after ${cfg.shuntTimeoutMs} ms` : String(e.message || e)); }
if (!res.ok) { log({ error: `HTTP ${res.status}`, model, files: files.map((f) => path.relative(process.cwd(), f)), question: question.slice(0, 200), ms: Date.now() - t0, cwd: process.cwd() }); die(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`); }
const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
const u = j.usage || {};
const price = priceFor(model);
const cost = price ? ((u.input_tokens || 0) * price.input + (u.output_tokens || 0) * price.output + (u.cache_read_input_tokens || 0) * (price.cacheRead || 0) + (u.cache_creation_input_tokens || 0) * (price.cacheWrite || price.input)) / 1e6 : null;
// Who asked? The most recent shunt deny for one of these files tells the caller's model, for the savings estimate.
let agent = null, callerPrice = 0;
try {
  const rels = new Set(files.map((f) => path.relative(process.cwd(), f)));
  const rows = fs.readFileSync(LOG, "utf8").trim().split("\n").slice(-200).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const d = rows.reverse().find((r) => r.kind === "deny" && rels.has(r.file) && Date.now() - new Date(r.ts) < 15 * 60000);
  if (d) { agent = d.agent; let ids = {}; try { ids = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")).models || {}; } catch {} const cp = priceFor(ids[d.alias] || ""); callerPrice = cp ? cp.input / 1e6 : 0; }
} catch {}
log({ model, agent, files: files.map((f) => path.relative(process.cwd(), f)), question: question.slice(0, 200), input: u.input_tokens || 0, output: u.output_tokens || 0,
  cache_read: u.cache_read_input_tokens || 0, cost, caller_input_price: callerPrice, ms: Date.now() - t0, cwd: process.cwd(), session_hint: process.env.CLAUDE_SESSION_ID || null });
if (asJson) console.log(JSON.stringify({ model, answer: text, usage: u, cost }, null, 2));
else console.log(text + `\n\n[bulk-read: ${model} · ${u.input_tokens || 0} in / ${u.output_tokens || 0} out${cost != null ? ` · $${cost.toFixed(4)}` : ""} · ${Date.now() - t0} ms]`);
