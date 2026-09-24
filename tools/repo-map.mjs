#!/usr/bin/env node
// repo-map: one cheap pass over a repository that writes the codebase map the other agents read instead of the tree.
//   node ~/.claude/tools/repo-map.mjs [--refresh] [--in-repo] [--model <gateway id>] [--dry-run]
// Run inside the repo (any worktree). Output:
//   ~/.claude/knowledge/repos/<repo>.md   (default: user-level, never committed)
//   docs/codebase-map.md                  (--in-repo: shared with the team, commit it yourself)
// plus one line per repo in ~/.claude/knowledge/index.md.
// Two halves: a deterministic scan (git + fs, no model: layout, scripts, CI stages, hotspots, owners) and ONE call to
// the shunt model (flash) over the key files (README, package manifest, CI, AGENTS/CLAUDE.md, docs, module entry
// points) that fills Purpose / Layout / Conventions / Data. Capped at ~250k chars of input and ~120 lines of output.
// The "## Gotchas" section is kept across refreshes: /ship's Learn step appends there.
// Freshness: without --refresh, an existing map younger than 30 days with fewer than 40 commits since is left alone.
// Log: logs/read-shunt.jsonl kind "map" (tokens, cost) — visible in cc-cost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "read-shunt.jsonl");
const DEFAULTS = { shuntModel: "fireworks/deepseek-v4.1-flash", shuntTimeoutMs: 180_000, mapMaxChars: 250_000, mapMaxAgeDays: 30, mapMaxCommits: 40 };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}
let PRICES = {}; try { PRICES = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "pricing.json"), "utf8")); } catch {}
const priceFor = (m = "") => PRICES[m] || PRICES[m.split("/").pop()] || null;
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), kind: "map", ...o }) + "\n"); } catch {} };
const die = (m) => { console.error("repo-map: " + m); process.exit(1); };
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const model = opt("--model") || cfg.shuntModel;
const REFRESH = argv.includes("--refresh"), IN_REPO = argv.includes("--in-repo"), DRY = argv.includes("--dry-run");

// ── deterministic scan ─────────────────────────────────────────────────
const sh = (c, def = "") => { try { return execSync(c, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).toString().trim(); } catch { return def; } };
const root = sh("git rev-parse --show-toplevel"); if (!root) die("not inside a git repository");
process.chdir(root);
// worktrees: the map belongs to the repo, not the worktree → name from the remote, fall back to the main worktree dir
const remote = sh("git remote get-url origin");
const repo = (remote.match(/[:/]([^/]+?)(?:\.git)?$/) || [])[1] || path.basename(sh("git worktree list").split("\n")[0].split(/\s+/)[0] || root);
const head = sh("git rev-parse --short HEAD"), branch = sh("git rev-parse --abbrev-ref HEAD");
const outFile = IN_REPO ? path.join(root, "docs", "codebase-map.md") : path.join(CFG_DIR, "knowledge", "repos", `${repo}.md`);

// freshness
let previous = null;
try { previous = fs.readFileSync(outFile, "utf8"); } catch {}
if (previous && !REFRESH) {
  const m = previous.match(/<!-- map: (\S+) · head (\w+)/);
  if (m) { const age = (Date.now() - new Date(m[1]).getTime()) / 86400000; const since = Number(sh(`git rev-list --count ${m[2]}..HEAD`, "999"));
    if (age < cfg.mapMaxAgeDays && since < cfg.mapMaxCommits) { console.log(`fresh: ${outFile} (${Math.round(age)}d old, ${since} commits since ${m[2]}). Use --refresh to rebuild.`); process.exit(0); } }
}
const gotchas = (previous && (previous.match(/## Gotchas[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/) || [])[1]?.trim()) || "";

const IGN = /^(node_modules|\.git|dist|build|coverage|\.next|\.turbo|vendor|target|\.venv|__pycache__|\.claude|\.aws-sam|cdk\.out)$/;
const tracked = sh("git ls-files").split("\n").filter(Boolean);
const byDir = new Map();
for (const f of tracked) { const parts = f.split("/"); if (IGN.test(parts[0])) continue; const k = parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : "(root)"; byDir.set(k, (byDir.get(k) || 0) + 1); }
const layout = [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([d, n]) => `${d} (${n})`).join(", ");
const ext = {}; for (const f of tracked) { const e = path.extname(f); if (e) ext[e] = (ext[e] || 0) + 1; }
const langs = Object.entries(ext).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => `${e} ${n}`).join(", ");
const hot = sh("git log --since='90 days ago' --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head -10").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^(\d+)\s+/, "$1× "));
const owners = sh("git shortlog -sn --since='180 days ago' HEAD | head -6").split("\n").map((l) => l.trim().replace(/^(\d+)\s+/, "$1 commits · ")).filter(Boolean);
const codeowners = ["CODEOWNERS", ".gitlab/CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].find((f) => fs.existsSync(f));
const ciFile = [".gitlab-ci.yml", ".github/workflows", "Jenkinsfile", "bitbucket-pipelines.yml"].find((f) => fs.existsSync(f));
const ciStages = ciFile === ".gitlab-ci.yml" ? (fs.readFileSync(ciFile, "utf8").match(/^stages:\n((?:\s+-\s+.+\n)+)/m) || [])[1]?.replace(/\s+-\s+/g, " ").trim() : "";
const commits = Number(sh("git rev-list --count HEAD", "0")), age = sh("git log --reverse --format=%cs | head -1");

// ── key files for the model ────────────────────────────────────────────
const cand = [];
const add = (f, max = 400) => { if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return; const lines = fs.readFileSync(f, "utf8").split("\n"); cand.push({ f, text: lines.slice(0, max).join("\n") + (lines.length > max ? `\n… (${lines.length - max} more lines)` : "") }); };
for (const f of ["README.md", "readme.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Makefile", "docker-compose.yml", "template.yaml", "samconfig.toml", "serverless.yml", "tsconfig.json", ".eslintrc.js", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs", "openspec/project.md"]) add(f, 300);
for (const f of tracked.filter((x) => /(^|\/)(AGENTS|CLAUDE|CONVENTIONS)\.md$/.test(x) && x.includes("/")).slice(0, 10)) add(f, 80);
for (const f of tracked.filter((x) => /^\.cursor\/rules\/.*\.mdc?$/.test(x)).slice(0, 6)) add(f, 80);
if (ciFile && ciFile.endsWith(".yml")) add(ciFile, 500);
if (ciFile === ".github/workflows") for (const w of fs.readdirSync(ciFile).slice(0, 4)) add(path.join(ciFile, w), 150);
if (codeowners) add(codeowners, 100);
for (const d of ["docs", "doc", "adr", "docs/adr", "docs/decisions", "docs/architecture"]) { if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md")).slice(0, 12)) add(path.join(d, f), 120); }
// entry point of each top module (src/<x>/index.* or main.*) — one per module, first 120 lines
const entries = tracked.filter((f) => /^(src|app|lib|packages|services|domains)\/[^/]+\/(index|main|app|handler|server)\.[cm]?[jt]sx?$/.test(f) || /^src\/[^/]+\/[^/]+\/(index|main)\.[cm]?[jt]sx?$/.test(f)).slice(0, 25);
for (const f of entries) add(f, 120);
// migrations: names only
const migrDirs = new Map(); for (const f of tracked) { if (!/\/migrations?\//i.test(f) || !/\.(sql|ts|js|py|rb|go)$/.test(f) || /snapshot|_journal|\.test\./.test(f)) continue; const d = path.dirname(f); (migrDirs.get(d) || migrDirs.set(d, []).get(d)).push(path.basename(f)); }
const migr = [...migrDirs].map(([d, xs]) => `${d} (${xs.length}; last: ${xs.sort().slice(-3).join(", ")})`);

let total = 0; const parts = [];
for (const c of cand) { const numbered = c.text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n"); if (total + numbered.length > cfg.mapMaxChars) break; total += numbered.length; parts.push(`<file path="${c.f}">\n${numbered}\n</file>`); }

const scan = `repo: ${repo} · head ${head} (${branch}) · ${commits} commits since ${age}
languages: ${langs}
layout (dir: tracked files): ${layout}
ci: ${ciFile || "none found"}${ciStages ? " · stages: " + ciStages : ""}
codeowners: ${codeowners || "none"}
migrations: ${migr.join(" · ") || "none"}
hot files (90d): ${hot.join(" · ")}
top committers (180d): ${owners.join(" · ")}`;

// ── one model call ─────────────────────────────────────────────────────
const base = (process.env.ANTHROPIC_BASE_URL || "https://api.llmgateway.io").replace(/\/$/, "");
let key = process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!key) { try { key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aircode", "config.json"), "utf8")).harness.llm_keys.llmgateway; } catch {} }
if (!key && !DRY) die("no gateway key: ANTHROPIC_AUTH_TOKEN not set and ~/.aircode/config.json unreadable");
const system = `You write the codebase map of a repository for engineers and coding agents who will read this map INSTEAD of exploring the tree. Only facts from the scan and the files given; no speculation, no marketing. Cite paths. Plain Markdown, no preamble, at most 100 lines total. Exactly these sections, in this order, each one starting with "## ":
## Purpose — 2 lines: what the service/library does and for whom.
## Layout — one line per top module: \`path/\` — responsibility (≤ 15 lines, most important first; say where the entry points, domain logic, infrastructure and tests live).
## Run · test · lint — the exact commands (from the manifest/Makefile/CI), one per line, including how to run ONE test file.
## CI / deploy — stages in order, what each deploys where, which steps are manual or gated, what happens on merge to main vs on a tag.
## Data — databases, ORM/migration tool, migrations folder and naming, how a migration is applied per environment (say "not stated" if unknown).
## Conventions — from lint config / AGENTS.md / CONTRIBUTING: language rules, test placement and naming, commit/MR conventions, anything an implementer must follow.
## Where to start — for a bug in X or a feature in Y, the 3–5 files to open first (path — why).`;
const user = `SCAN (deterministic, trust it):\n${scan}\n\nKEY FILES (first lines of each):\n\n${parts.join("\n\n")}`;
if (DRY) { console.log(scan); console.log(`\n[dry-run] ${parts.length} files · ${total} chars → ${model} · would write ${outFile}`); process.exit(0); }
const t0 = Date.now(); let res, j;
try {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.shuntTimeoutMs);
  res = await fetch(`${base}/v1/messages`, { method: "POST", signal: ctl.signal, body: JSON.stringify({ model, max_tokens: 8000, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", Authorization: `Bearer ${key}`, "x-api-key": key } });
  clearTimeout(timer); j = await res.json().catch(() => ({}));
} catch (e) { log({ repo, error: String(e.name === "AbortError" ? "timeout" : e.message), model }); die(String(e.message || e)); }
if (!res.ok) { log({ repo, error: `HTTP ${res.status}`, model }); die(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`); }
let text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
if (j.stop_reason === "max_tokens") { console.error("repo-map: the model hit max_tokens — the map may be cut short; re-run with --refresh (the model spends output on reasoning) or a bigger model with --model"); }
const u = j.usage || {}, price = priceFor(model);
const cost = price ? ((u.input_tokens || 0) * price.input + (u.output_tokens || 0) * price.output + (u.cache_read_input_tokens || 0) * (price.cacheRead || 0) + (u.cache_creation_input_tokens || 0) * (price.cacheWrite || price.input)) / 1e6 : null;
const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
text = text.split("\n").slice(0, 110).join("\n");

// ── assemble + write ───────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const doc = `# ${repo} — codebase map
<!-- map: ${today} · head ${head} · ${model} · ${inTok} in${u.cache_read_input_tokens ? ` (${u.cache_read_input_tokens} cached)` : ""} / ${u.output_tokens || 0} out${cost != null ? ` · $${cost.toFixed(3)}` : ""} · refresh: node ~/.claude/tools/repo-map.mjs --refresh${IN_REPO ? " --in-repo" : ""} -->

${text}

## Hotspots (90d, from git)
${hot.map((h) => `- ${h}`).join("\n") || "- none"}

## Owners
${codeowners ? `- CODEOWNERS: ${codeowners}\n` : ""}${owners.map((o) => `- ${o}`).join("\n")}

## Gotchas (kept by /ship Learn — one line each, newest last)
${gotchas || "- (none yet)"}
`;
fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, doc);
// index line
const idx = path.join(CFG_DIR, "knowledge", "index.md"); let index = ""; try { index = fs.readFileSync(idx, "utf8"); } catch { index = "# Repos I work on — one line each (kept by /map; edit freely)\n"; }
const purpose = (text.match(/## Purpose[^\n]*\n([^\n]+)/) || [])[1]?.replace(/\s+/g, " ").slice(0, 90) || "";
const line = `- ${repo} · ${IN_REPO ? "docs/codebase-map.md" : `knowledge/repos/${repo}.md`} · ${purpose} · map: ${today}`;
index = index.split("\n").filter((l) => !l.startsWith(`- ${repo} ·`)).join("\n").replace(/\n*$/, "\n") + line + "\n";
fs.writeFileSync(idx, index);
log({ repo, model, files: cand.length, input: u.input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, cost, ms: Date.now() - t0, out: outFile });
console.log(`${outFile}\n${doc.split("\n").length} lines · ${cand.length} files read · ${inTok} in / ${u.output_tokens || 0} out${cost != null ? ` · $${cost.toFixed(3)}` : ""} · ${Math.round((Date.now() - t0) / 1000)}s`);
