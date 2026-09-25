#!/usr/bin/env node
// retro-report: the numbers behind /retro — what the harness did in the last N days, from its own logs, no model.
//   node ~/.claude/tools/retro-report.mjs [--days 7] [--json]
//   node ~/.claude/tools/retro-report.mjs --close "<what was decided, one line per change>"   # appends "## Retro <date>" to knowledge/process.md
// Reads ~/.claude/logs/{ship-stages,subagents,model-router,ship-gates,bash-guard,read-shunt,code-write}.jsonl,
// cc-cost --days N --all --json (cost per session/branch) and knowledge/process.md (lessons since the last retro).
// Prints a short Markdown report: tickets and stage times, cost per branch, subagent durations, router decisions and
// fallbacks, gate bounces/denies, guard denies, shunt savings, open process lessons — each with the concrete signal
// a retro can act on (a row that is slow, a use case that falls back, a gate that never fires…).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), JSON_OUT = argv.includes("--json");
if (argv.includes("--close")) { const note = argv[argv.indexOf("--close") + 1] || ""; if (!note.trim()) { console.error("retro-report: --close needs a text"); process.exit(1); }
  const f = path.join(CFG_DIR, "knowledge", "process.md"); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `\n## Retro ${new Date().toISOString().slice(0, 10)}\n${note.split(/\n|; /).map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("- ") ? l : "- " + l)).join("\n")}\n`);
  console.log(`retro recorded in ${f} — lessons above it count as handled`); process.exit(0); }
const DAYS = Number(argv.includes("--days") ? argv[argv.indexOf("--days") + 1] : 7) || 7;
const since = Date.now() - DAYS * 86400000;
const rows = (f) => { try { return fs.readFileSync(path.join(CFG_DIR, "logs", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.ts && new Date(r.ts).getTime() >= since); } catch { return []; } };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p90 = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
const min = (s) => (s == null ? "-" : s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
const usd = (x) => (x == null ? "-" : `$${x.toFixed(2)}`);
const group = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const out = [], R = {};
const H = (t) => out.push(`\n## ${t}`);

// ── tickets & stages ───────────────────────────────────────────────────
const stages = rows("ship-stages.jsonl");
const HUMAN = new Set(["gate-facts", "gate-human", "stop-mr", "ready-for-merge"]);
R.tickets = [...group(stages, (r) => r.ticket)].map(([t, xs]) => ({ ticket: t, repo: xs[0].repo, stages: xs.length, last: xs[xs.length - 1].to, agent_minutes: Math.round(xs.filter((x) => !HUMAN.has(x.stage)).reduce((a, x) => a + (x.seconds || 0), 0) / 60), attempts: xs.reduce((a, x) => a + (x.attempts || 0), 0) }));
R.stage_medians = [...group(stages.filter((r) => !HUMAN.has(r.stage) && r.seconds != null), (r) => r.stage)].map(([s, xs]) => ({ stage: s, n: xs.length, median_s: median(xs.map((x) => x.seconds)), max_s: Math.max(...xs.map((x) => x.seconds)) }));
H(`Tickets (${DAYS}d)`);
if (!R.tickets.length) out.push("- none through /ship");
for (const t of R.tickets) out.push(`- ${t.ticket} (${t.repo}) — ${t.stages} transitions, last → ${t.last}, ${t.agent_minutes}m of agent time, ${t.attempts} extra attempt(s)`);
if (R.stage_medians.length) out.push("- stage medians: " + R.stage_medians.map((s) => `${s.stage} ${min(s.median_s)}${s.max_s > 2 * s.median_s ? ` (max ${min(s.max_s)})` : ""}`).join(" · "));

// ── cost per branch (cc-cost) ──────────────────────────────────────────
let sessions = [];
try { sessions = JSON.parse(execFileSync(process.execPath, [path.join(CFG_DIR, "tools", "cc-cost.mjs"), "--days", String(DAYS), "--all", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch {}
R.cost = { total: sessions.reduce((a, s) => a + (s.cost || 0), 0), sessions: sessions.length, by_branch: [...group(sessions, (s) => s.branch || "(no branch)")].map(([b, xs]) => ({ branch: b, sessions: xs.length, cost: xs.reduce((a, s) => a + (s.cost || 0), 0), subagents: xs.reduce((a, s) => a + (s.subagents || 0), 0) })).sort((a, b) => b.cost - a.cost) };
H("Cost");
out.push(`- ${usd(R.cost.total)} over ${R.cost.sessions} session(s)`);
for (const b of R.cost.by_branch.slice(0, 8)) out.push(`- ${b.branch}: ${usd(b.cost)} · ${b.sessions} session(s) · ${b.subagents} subagents`);

// ── subagents ──────────────────────────────────────────────────────────
const subs = rows("subagents.jsonl").filter((r) => r.duration_s != null && r.base);
R.subagents = [...group(subs, (r) => r.base)].map(([b, xs]) => ({ base: b, n: xs.length, median_s: median(xs.map((x) => x.duration_s)), p90_s: p90(xs.map((x) => x.duration_s)), max_s: Math.max(...xs.map((x) => x.duration_s)), models: [...group(xs, (x) => x.model || "?")].map(([m, ys]) => `${m.split("/").pop()}×${ys.length}`).join(" ") })).sort((a, b) => b.n - a.n);
H("Subagents");
if (!R.subagents.length) out.push("- no finished subagents logged (log-subagent.mjs)");
for (const s of R.subagents) out.push(`- ${s.base}: ${s.n} runs · median ${min(s.median_s)} · p90 ${min(s.p90_s)}${s.max_s > 1800 ? ` · **max ${min(s.max_s)}**` : ""} · ${s.models}`);
const slow = subs.filter((r) => r.duration_s > 1800);
if (slow.length) out.push(`- ⚠ ${slow.length} run(s) over 30 min: ` + slow.slice(0, 5).map((r) => `${r.base} ${min(r.duration_s)} (${(r.model || "?").split("/").pop()})`).join(", "));

// ── router ─────────────────────────────────────────────────────────────
const rt = rows("model-router.jsonl");
R.router = { launches: rt.length, applied: rt.filter((r) => r.applied).length, jev_fallback: rt.filter((r) => /jev|timeout|rules/i.test(r.source || "") && !/^jev/.test(r.source || "")).length, by_case: [...group(rt, (r) => `${r.use_case}/${r.complexity}`)].filter(([k]) => !k.startsWith("undefined")).map(([k, xs]) => ({ case: k, n: xs.length, targets: [...group(xs, (x) => `${x.alias}·${x.effort}`)].map(([t, ys]) => `${t}×${ys.length}`).join(" ") })).sort((a, b) => b.n - a.n), builtins: rt.filter((r) => r.builtin).length, role_mismatch: rt.filter((r) => r.role_mismatch && !/^(task|general-purpose|solo)$/.test(r.subagent || "")).length, undecided: rt.filter((r) => !r.use_case).length };
const launches = rows("agent-launches.jsonl");
R.router.unrouted = Math.max(0, launches.length - rt.length);
H("Router");
out.push(`- ${R.router.launches} routed launches (${R.router.applied} rewritten) · ${R.router.jev_fallback} decided by rules (Jev timeout/error) · ${R.router.builtins} built-in agent(s) caught · ${R.router.role_mismatch} role mismatch(es) (a named role, re-routed)${R.router.undecided ? ` · ${R.router.undecided} with no decision (router error)` : ""}${R.router.unrouted ? ` · **${R.router.unrouted} launch(es) with no router entry** (hook killed or not fired; aircode sessions are unrouted by design)` : ""}`);
for (const c of R.router.by_case.slice(0, 10)) out.push(`- ${c.case}: ${c.n} → ${c.targets}`);

// ── gates & guard ──────────────────────────────────────────────────────
const gates = rows("ship-gates.jsonl"), guard = rows("bash-guard.jsonl");
R.gates = [...group(gates, (r) => `${r.gate}:${r.action}`)].map(([k, xs]) => `${k}×${xs.length}`);
R.guard = { denied: guard.filter((r) => r.verdict === "destructive").length, confirmed: guard.filter((r) => r.verdict === "confirmed").length, classified: guard.filter((r) => r.verdict && r.verdict !== "confirmed").length, denied_cmds: guard.filter((r) => r.verdict === "destructive").map((r) => (r.command || "").slice(0, 70)) };
H("Gates & guard");
out.push(`- ship gates: ${R.gates.join(" · ") || "none fired"}`);
out.push(`- bash-guard: ${R.guard.classified} classified · ${R.guard.denied} denied · ${R.guard.confirmed} confirmed by the user`);
for (const c of R.guard.denied_cmds.slice(0, 5)) out.push(`  - denied: \`${c}\``);

// ── shunt / cheap helpers ──────────────────────────────────────────────
const shunt = rows("read-shunt.jsonl"), cw = rows("code-write.jsonl");
const br = shunt.filter((r) => r.kind === "bulk-read" && !r.error), maps = shunt.filter((r) => r.kind === "map" && !r.error), denies = shunt.filter((r) => r.kind === "deny");
const saved = br.reduce((a, r) => a + ((r.input || 0) * ((r.caller_input_price || 0) - 0)), 0) - br.reduce((a, r) => a + (r.cost || 0), 0);
R.shunt = { denies: denies.length, bulk_reads: br.length, bulk_cost: br.reduce((a, r) => a + (r.cost || 0), 0), est_saved: saved, maps: maps.length, map_cost: maps.reduce((a, r) => a + (r.cost || 0), 0), code_writes: cw.length };
H("Cheap helpers");
out.push(`- read-shunt: ${R.shunt.denies} big reads redirected → ${R.shunt.bulk_reads} bulk-reads for ${usd(R.shunt.bulk_cost)}${saved > 0 ? ` (≈${usd(saved)} not paid at the caller's price)` : ""} · ${R.shunt.maps} map(s) ${usd(R.shunt.map_cost)} · ${R.shunt.code_writes} code-write(s)`);

// ── open process lessons ───────────────────────────────────────────────
let lessons = [];
try { const txt = fs.readFileSync(path.join(CFG_DIR, "knowledge", "process.md"), "utf8"); const lastRetro = txt.lastIndexOf("\n## Retro "); lessons = txt.slice(lastRetro < 0 ? 0 : lastRetro).split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)); } catch {}
R.lessons = lessons;
H("Process lessons since the last retro");
if (!lessons.length) out.push("- none recorded");
for (const l of lessons) out.push(l);

if (JSON_OUT) console.log(JSON.stringify(R, null, 2)); else console.log(`# Retro — last ${DAYS} days (${new Date().toISOString().slice(0, 10)})` + out.join("\n"));
