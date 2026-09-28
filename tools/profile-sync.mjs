#!/usr/bin/env node
// profile-sync <profile dir> [--quiet] [--force]: keeps a second Claude Code profile (e.g. ~/.claude-anthropic, used
// with the Claude login instead of LLM Gateway) in step with the main harness in ~/.claude. Run by the claude-anthropic
// launcher on every start; does nothing unless ~/.claude changed since the last sync (or --force).
//   shared (symlinks to ~/.claude): hooks tools commands templates knowledge skills plugins statusline.mjs pricing.json CLAUDE.md
//   derived (rewritten here): settings.json (same hooks and permissions, no gateway env), router.json (same table,
//     Anthropic models, "fable" profile), agents/ (same prompts, Anthropic models, + lead-fable, + variants)
//   own (never touched): login, .claude.json after the first start, projects/, logs/, sessions
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2), P = path.resolve(argv.find((a) => !a.startsWith("--")) || path.join(os.homedir(), ".claude-anthropic"));
const QUIET = argv.includes("--quiet"), FORCE = argv.includes("--force");
const BASE = path.join(os.homedir(), ".claude");
const say = (m) => { if (!QUIET) console.log(m); };

// Anthropic model map (checked against platform.claude.com/docs/en/models/overview, 2026-09-28).
const MODELS = { flash: "claude-haiku-4-5-20251001", luna: "claude-haiku-4-5-20251001", pro: "claude-sonnet-5", sol: "claude-opus-5-5", opus: "claude-opus-5-5", web: "claude-sonnet-5", fable: "claude-fable-5-1" };
// base agent model (gateway id) → Anthropic id; primary agents (lead, solo) get Sonnet whatever they had.
const AGENT_MODEL = { "fireworks/deepseek-v4.1-flash": MODELS.flash, "fireworks/deepseek-v4-pro": MODELS.pro, "gpt-6-sol": MODELS.sol, "gpt-6-luna": MODELS.luna, "fireworks/kimi-k3": MODELS.opus };
const PRIMARY_MODEL = { "lead.md": "claude-sonnet-5", "solo.md": "claude-sonnet-5" };
const SHARED = ["hooks", "tools", "commands", "templates", "knowledge", "skills", "plugins", "statusline.mjs", "pricing.json", "CLAUDE.md"];

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const newest = (dir) => { let m = mtime(dir); try { for (const f of fs.readdirSync(dir)) m = Math.max(m, mtime(path.join(dir, f))); } catch {} return m; };
const STAMP = path.join(P, ".profile-sync");
const baseChanged = Math.max(newest(path.join(BASE, "agents")), mtime(path.join(BASE, "settings.json")), mtime(path.join(BASE, "router.json")), mtime(new URL(import.meta.url)));
if (!FORCE && fs.existsSync(STAMP) && mtime(STAMP) >= baseChanged) process.exit(0);

fs.mkdirSync(path.join(P, "agents"), { recursive: true }); fs.mkdirSync(path.join(P, "logs"), { recursive: true });

// 1. shared: symlinks (an existing real file or dir with that name is left alone and reported)
for (const n of SHARED) {
  const src = path.join(BASE, n), dst = path.join(P, n);
  if (!fs.existsSync(src)) continue;
  let st = null; try { st = fs.lstatSync(dst); } catch {}
  if (!st) { fs.symlinkSync(src, dst); continue; }
  if (!st.isSymbolicLink()) say(`  ! ${dst} is a real ${st.isDirectory() ? "folder" : "file"}, not linked to ${src}: move it away to share it`);
}

// 2. settings.json: base settings minus the gateway, keeping what Claude Code writes into this profile (plugins, marketplaces)
const readJson = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const base = readJson(path.join(BASE, "settings.json")), own = readJson(path.join(P, "settings.json"));
const settings = JSON.parse(JSON.stringify(base));
delete settings.model; delete settings.apiKeyHelper;
if (settings.env) { for (const k of Object.keys(settings.env)) if (/^ANTHROPIC_|^CLAUDE_CODE_(USE_|SUBAGENT_MODEL)/.test(k)) delete settings.env[k]; }
for (const k of ["enabledPlugins", "extraKnownMarketplaces"]) if (own[k]) settings[k] = { ...(settings[k] || {}), ...own[k] };
const overlay = readJson(path.join(P, "profile.settings.json"), null); if (overlay) Object.assign(settings, overlay);   // your own overrides for this profile
fs.writeFileSync(path.join(P, "settings.json"), JSON.stringify(settings, null, 2) + "\n");

// 3. router.json: the same table and row overrides as the main profile, Anthropic models, and the "fable" profile
const router = readJson(path.join(BASE, "router.json"));
router.models = { ...(router.models || {}), ...MODELS };
router.profiles = { ...(router.profiles || {}), fable: { models: { fable: MODELS.fable }, remap: { opus: "fable" } } };
fs.writeFileSync(path.join(P, "router.json"), JSON.stringify(router, null, 2) + "\n");

// 4. agents: base agents with Anthropic models, lead-fable for --fable=all, then the router variants
const isVariant = (f) => /--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)\.md$/.test(f);
for (const f of fs.readdirSync(path.join(P, "agents"))) if (f.endsWith(".md")) fs.unlinkSync(path.join(P, "agents", f));
let n = 0;
for (const f of fs.readdirSync(path.join(BASE, "agents"))) {
  if (!f.endsWith(".md") || isVariant(f)) continue;
  let src = fs.readFileSync(path.join(BASE, "agents", f), "utf8");
  src = src.replace(/^model:\s*(.+)$/m, (_, m) => `model: ${PRIMARY_MODEL[f] || AGENT_MODEL[m.trim()] || m.trim()}`);
  fs.writeFileSync(path.join(P, "agents", f), src); n++;
  if (f === "lead.md") fs.writeFileSync(path.join(P, "agents", "lead-fable.md"), src.replace(/^name:\s*lead\s*$/m, "name: lead-fable").replace(/^model:\s*.+$/m, `model: ${MODELS.fable}`));
}
try { execFileSync(process.execPath, [path.join(BASE, "tools", "gen-effort-variants.mjs")], { env: { ...process.env, CLAUDE_CONFIG_DIR: P }, stdio: QUIET ? "ignore" : "inherit" }); }
catch (e) { console.error(`  ✗ variants: ${e.message}`); process.exit(1); }

fs.writeFileSync(STAMP, new Date().toISOString() + "\n");
say(`  ✓ profile ${P} synced: ${n} agents (+ lead-fable), settings.json, router.json (Anthropic models, fable profile)`);
