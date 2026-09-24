#!/usr/bin/env node
// code-write: let a cheap model write mechanical code (fixtures, migrations, table tests, types from a schema,
// boilerplate copied from an existing module) straight to disk, from a spec and reference files. The calling agent
// never sees the generated code: it pays for the spec, not for the output. Companion of bulk-read (after Spotify's
// shunt plugin), through the Aircall gateway.
//   node ~/.claude/tools/code-write.mjs "<spec>" --out <path> --ref <file> [--ref …] [--overwrite] [--no-ref] [--model <id>]
// Guard rails (on purpose): refuses on main/master; refuses to overwrite an existing file without --overwrite;
// the bash-guard hook only lets implementer variants on pro/sol run it (router.json codeWriteAgents).
// After it: run the tests and `git diff --stat`; the caller verifies by executing, not by reading.
// Config in ~/.claude/router.json: shuntModel (default fireworks/deepseek-v4.1-flash), codeWriteMaxChars (600k).
// Log: logs/code-write.jsonl · Report: node ~/.claude/tools/code-write.mjs --report [days]
//   (the report checks each generated file's current hash: "kept as generated" vs "edited afterwards" is the metric
//    that says whether delegating the write paid off).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "code-write.jsonl");
const DEFAULTS = { shuntModel: "fireworks/deepseek-v4.1-flash", codeWriteMaxChars: 600_000, shuntTimeoutMs: 180_000 };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}
let PRICES = {}; try { PRICES = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "pricing.json"), "utf8")); } catch {}
const priceFor = (m = "") => PRICES[m] || PRICES[m.split("/").pop()] || null;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} };
const die = (m) => { console.error("code-write: " + m); process.exit(1); };

// ── report ─────────────────────────────────────────────────────────────
if (process.argv[2] === "--report") {
  const days = Number(process.argv[3] || 7), since = Date.now() - days * 86400000;
  let rows = []; try { rows = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => new Date(r.ts).getTime() >= since); } catch {}
  const ok = rows.filter((r) => !r.error), er = rows.filter((r) => r.error);
  let kept = 0, edited = 0, gone = 0;
  const state = ok.map((r) => { const p = path.resolve(r.cwd || ".", r.out); let s = "gone"; try { s = sha(fs.readFileSync(p, "utf8")) === r.sha ? "kept" : "edited"; } catch {} if (s === "kept") kept++; else if (s === "edited") edited++; else gone++; return [r, s]; });
  const cost = ok.reduce((a, r) => a + (r.cost || 0), 0), outTok = ok.reduce((a, r) => a + (r.output || 0), 0);
  console.log(`code-write — last ${days} days — ${ok.length} files generated · ${outTok} output tokens by ${cfg.shuntModel} · $${cost.toFixed(4)}${er.length ? ` · ${er.length} errors` : ""}`);
  if (ok.length) console.log(`  kept as generated ${kept} · edited afterwards ${edited} · deleted/moved ${gone}   (mostly kept = delegating paid off; mostly edited = specs too vague or tasks not mechanical)`);
  for (const [r, s] of state.slice(-8)) console.log(`  ${r.ts.slice(5, 16).replace("T", " ")}  ${s.padEnd(6)} ${String(r.lines).padStart(4)} lines  ${r.out}  "${(r.spec || "").slice(0, 50)}"`);
  if (er.length) console.log("  errors: " + [...new Set(er.map((r) => r.error))].join(" | "));
  process.exit(0);
}

// ── args ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const refs = []; let out = null, overwrite = false, noRef = false, model = cfg.shuntModel, spec = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--ref") refs.push(argv[++i]);
  else if (argv[i] === "--out") out = argv[++i];
  else if (argv[i] === "--overwrite") overwrite = true;
  else if (argv[i] === "--no-ref") noRef = true;
  else if (argv[i] === "--model") model = argv[++i];
  else if (argv[i].startsWith("--")) die(`unknown flag ${argv[i]}`);
  else if (spec === null) spec = argv[i];
  else die(`unexpected argument ${argv[i]} (quote the spec; files go after --ref)`);
}
if (!spec || !out) die('usage: code-write "<spec>" --out <path> --ref <file> [--ref …] [--overwrite]');
if (!refs.length && !noRef) die("no --ref given: pass at least one file to imitate (the module under test, a sibling test…). Without references the model invents the API. --no-ref only for files with no counterpart in the repo");
if (spec.length < 40) die("the spec is too short to generate anything reliable: say what the file must contain, its inputs/outputs and which reference file to imitate");

// ── guard rails ────────────────────────────────────────────────────────
const git = (a) => { try { return execSync(`git ${a}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const branch = git("rev-parse --abbrev-ref HEAD");
const inWorktree = git("rev-parse --git-dir") !== git("rev-parse --git-common-dir"); // linked worktree vs main working tree
if (!branch) die("not inside a git repository");
if (/^(main|master)$/.test(branch)) die(`refusing to write on branch ${branch}: work in a ticket worktree (claude @ticket <T>)`);
if (branch === "HEAD" && !inWorktree) die("refusing to write on a detached HEAD in the main working tree: work in a ticket worktree (claude @ticket <T>)");
const outAbs = path.resolve(out);
if (fs.existsSync(outAbs) && !overwrite) die(`${out} exists; pass --overwrite only if replacing it whole is what the task asks for`);
let total = 0; const refParts = [];
for (const r of refs) {
  let text; try { text = fs.readFileSync(path.resolve(r), "utf8"); } catch { die(`reference not readable: ${r}`); }
  total += text.length; if (total > cfg.codeWriteMaxChars) die(`references exceed ${cfg.codeWriteMaxChars} chars; pass fewer or smaller ones`);
  refParts.push(`<reference path="${path.relative(process.cwd(), path.resolve(r)) || r}">\n${text}\n</reference>`);
}
const ext = path.extname(outAbs).slice(1) || "txt";

// ── gateway call ───────────────────────────────────────────────────────
const base = (process.env.ANTHROPIC_BASE_URL || "https://api.llmgateway.io").replace(/\/$/, "");
let key = process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!key) { try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {} }
if (!key) die("no gateway key: ANTHROPIC_AUTH_TOKEN not set and ~/.aircode/config.json unreadable");
const system = `You write one source file for a senior engineer who will not read it: it will be checked by running tests and linters. Output ONLY the file's content: no markdown fences, no explanations, no leading or trailing commentary.
Match the reference files' patterns, conventions, naming, imports, formatting and style exactly; reuse their helpers instead of inventing new ones. Add no dependencies. No TODOs, no placeholder logic: if the spec is not enough to write a part, write it as the references would and keep it minimal. The target file is ${out} (${ext}).`;
const user = `Spec:\n${spec}\n\n${refParts.length ? refParts.join("\n\n") : "(no reference files given: follow common conventions for ." + ext + ")"}`;
const t0 = Date.now(); let res, j;
try {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.shuntTimeoutMs);
  res = await fetch(`${base}/v1/messages`, { method: "POST", signal: ctl.signal, body: JSON.stringify({ model, max_tokens: 16000, temperature: 0.1, system, messages: [{ role: "user", content: user }] }),
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", Authorization: `Bearer ${key}`, "x-api-key": key } });
  clearTimeout(timer); j = await res.json().catch(() => ({}));
} catch (e) { log({ error: e.name === "AbortError" ? "timeout" : String(e.message || e), out, refs, spec: spec.slice(0, 200), cwd: process.cwd() }); die(e.name === "AbortError" ? "timeout" : String(e.message || e)); }
if (!res.ok) { log({ error: `HTTP ${res.status}`, out, refs, spec: spec.slice(0, 200), cwd: process.cwd() }); die(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`); }
let text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
text = text.replace(/^\s*```[a-zA-Z0-9_+-]*\s*\n/, "").replace(/\n```\s*$/, "").replace(/\s+$/, "") + "\n";
if (text.trim().length < 10) { log({ error: "empty output", out, refs, spec: spec.slice(0, 200), cwd: process.cwd() }); die("the model returned no content"); }
if (j.stop_reason === "max_tokens") { log({ error: "truncated (max_tokens)", out, refs, spec: spec.slice(0, 200), cwd: process.cwd() }); die("output truncated at max_tokens: split the file or narrow the spec"); }
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, text);
const u = j.usage || {}, price = priceFor(model);
const cost = price ? ((u.input_tokens || 0) * price.input + (u.output_tokens || 0) * price.output) / 1e6 : null;
const lines = text.split("\n").length - 1;
log({ model, out: path.relative(process.cwd(), outAbs), refs: refs.map((r) => path.relative(process.cwd(), path.resolve(r))), spec: spec.slice(0, 300), lines, sha: sha(text), input: u.input_tokens || 0, output: u.output_tokens || 0, cost, ms: Date.now() - t0, cwd: process.cwd(), branch });
console.log(`code-write: wrote ${path.relative(process.cwd(), outAbs)} (${lines} lines) from ${refs.length} reference(s) · ${model} · ${u.input_tokens || 0} in / ${u.output_tokens || 0} out${cost != null ? ` · $${cost.toFixed(4)}` : ""} · ${Date.now() - t0} ms
Next: run the tests and the linter, then \`git diff --stat\`. Do not read the file whole; fix failures with windowed Reads and Edits.`);
