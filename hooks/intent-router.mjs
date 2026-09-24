#!/usr/bin/env node
// UserPromptSubmit hook — asks Jev what the user's message is (intent) and which skill fits, and injects that as
// additional context for the turn: "run /review-mr …", "load skill glab", "delegate as a plan". One Jev call per
// user message (~0.5 s). Only in plain `claude` sessions: aircode sessions are skipped (they carry their own agents).
//
// Config in ~/.claude/router.json: intentMode "on"|"off" (default on), intentMinConfidence (0.5),
//   jevUrl / jevModel / jevKeyEnv / jevTimeoutMs shared with model-router.
// Log: logs/intent-router.jsonl · Report: node ~/.claude/hooks/intent-router.mjs --report [days]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "intent-router.jsonl");
const DEFAULTS = { intentMode: "on", intentMinConfidence: 0.5, jevUrl: "https://api.llmgateway.io/v1/systemone", jevModel: "jev-1.13.0", jevKeyEnv: "JEV_LLMGATEWAY_KEY", jevTimeoutMs: 4000 };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}

// Intents: what the lead should do with the message. Each maps to a routing hint.
const INTENTS = {
  review_mr:   ["Review a merge request, a diff or a branch",                    "Run the /review-mr command with the MR reference from the message (default scope blockers; add --full if the user asks for everything)."],
  plan:        ["Plan a ticket, break work down, write a proposal or an ADR",      "Delegate to task with a brief starting with 'plan:' (or 'adr:'); do not implement yet."],
  implement:   ["Change code: feature, fix, refactor, tests, migration, config",   "Delegate to task with a brief starting with 'change:'; state files, constraints and done-when. If the request is large or ambiguous, plan first."],
  investigate: ["Find out a status, a root cause, why something fails or what happened", "Delegate to task with a brief starting with 'lookup:' or 'root cause:'."],
  explain:     ["Explain or locate code, how something works",                     "Delegate to task with a brief starting with 'read-only:'."],
  docs:        ["Write documentation, an MR description, release notes, a runbook", "Delegate to task with a brief starting with 'change: docs …' (mode docs)."],
  git:         ["Git or worktree operations: branch, commit, push, rebase, cleanup", "Do it with Bash in the current worktree; never on main; push only if explicitly asked in this message."],
  question:    ["A question to answer directly, or a conversation, no work in the repo", "Answer directly; do not launch subagents."],
  other:       ["Anything else",                                                    ""],
};

const skip = (why) => { log({ skipped: why }); process.exit(0); };
function log(o) { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} }

// ── skills available to this session (user + project), from SKILL.md frontmatter ─────────────
function skills(cwd) {
  const out = {};
  for (const dir of [path.join(CFG_DIR, "skills"), cwd && path.join(cwd, ".claude", "skills")].filter(Boolean)) {
    let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      try {
        const s = fs.readFileSync(path.join(dir, n, "SKILL.md"), "utf8");
        const name = s.match(/^name:\s*(.+)$/m)?.[1]?.trim() || n;
        const desc = (s.match(/^description:\s*>?\s*\n?((?:.|\n)*?)(?=\n[a-z-]+:|\n---)/m)?.[1] || s.match(/^description:\s*(.+)$/m)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 160);
        out[name] = desc || name;
      } catch {}
    }
  }
  return out;
}

// ── report ─────────────────────────────────────────────────────────────
if (process.argv[2] === "--report") {
  const days = Number(process.argv[3] || 7), since = Date.now() - days * 86400000;
  let rows = []; try { rows = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => new Date(r.ts).getTime() >= since); } catch {}
  const ok = rows.filter((r) => r.intent), sk = rows.filter((r) => r.skipped), er = rows.filter((r) => r.error);
  console.log(`Intent router — last ${days} days — ${rows.length} prompts: ${ok.length} routed · ${sk.length} skipped · ${er.length} errors`);
  const cnt = (xs, k) => [...xs.reduce((m, r) => m.set(r[k], (m.get(r[k]) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  if (ok.length) console.log("  intents: " + cnt(ok, "intent").map(([k, n]) => `${k} ${n}`).join(" · "));
  const withSkill = ok.filter((r) => r.skill && r.skill !== "none");
  if (withSkill.length) console.log("  skills:  " + cnt(withSkill, "skill").map(([k, n]) => `${k} ${n}`).join(" · "));
  if (sk.length) console.log("  skipped: " + cnt(sk, "skipped").map(([k, n]) => `${k} ${n}`).join(" · "));
  if (er.length) console.log("  errors:  " + [...new Set(er.map((r) => r.error))].join(" | "));
  const avg = ok.length ? Math.round(ok.reduce((a, r) => a + (r.ms || 0), 0) / ok.length) : 0;
  console.log(`  avg latency ${avg} ms · low-confidence (not injected) ${rows.filter((r) => r.below_threshold).length}`);
  for (const r of ok.slice(-6)) console.log(`  ${r.ts.slice(5, 16).replace("T", " ")}  ${String(r.intent).padEnd(12)} ${String(r.skill || "-").padEnd(14)} "${(r.prompt || "").slice(0, 70)}"`);
  process.exit(0);
}

// ── hook ───────────────────────────────────────────────────────────────
let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const prompt = String(input.prompt || "").trim();
if (cfg.intentMode === "off") skip("off");
if (process.env.AIRCODE_SESSION_METADATA_PATH || /aircall-aircode-agents/.test(process.env.CLAUDE_CODE_AGENT || "")) skip("aircode session");
if (!prompt || prompt.startsWith("/") || prompt.startsWith("!") || prompt.length < 12) skip("command or too short");
const key = process.env[cfg.jevKeyEnv];
if (!key) skip("no key");

const sk = skills(input.cwd);
const skillCriteria = { none: "No specific skill is needed for this message", ...sk };
const body = {
  model: cfg.jevModel,
  state: { message: prompt.slice(0, 1200), cwd: input.cwd ? path.basename(input.cwd) : "" },
  questions: {
    intent: { type: "choice", instructions: "A user typed this message to a coding assistant that coordinates specialised subagents. Pick the single intent that best describes what the user wants done now.",
      criteria: Object.fromEntries(Object.entries(INTENTS).map(([k, [d]]) => [k, d])) },
    ...(Object.keys(sk).length ? { skill: { type: "choice", instructions: "Which one of these skills (reusable instructions) would most help with this message? Pick 'none' unless a skill clearly applies.", criteria: skillCriteria } } : {}),
  },
};
const t0 = Date.now();
try {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.jevTimeoutMs);
  const res = await fetch(cfg.jevUrl, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (!res.ok) { log({ error: `HTTP ${res.status}`, ms, prompt: prompt.slice(0, 120) }); process.exit(0); }
  const j = await res.json();
  const it = j.answers?.intent, s = j.answers?.skill;
  const intent = it?.choice, iconf = it?.confidence ?? 0;
  const skill = s?.choice && s.choice !== "none" && (s.confidence ?? 0) >= cfg.intentMinConfidence ? s.choice : null;
  const lines = [];
  if (intent && INTENTS[intent] && iconf >= cfg.intentMinConfidence && INTENTS[intent][1]) lines.push(`Intent: ${intent} (${iconf.toFixed(2)}). ${INTENTS[intent][1]}`);
  if (skill) lines.push(`Skill: load "${skill}" before doing the work (${(s.confidence ?? 0).toFixed(2)}).`);
  log({ intent, intent_confidence: iconf, skill: s?.choice ?? null, skill_confidence: s?.confidence ?? null, below_threshold: !lines.length, ms, tokens: j.usage?.input_tokens ?? null, prompt: prompt.slice(0, 120), cwd: input.cwd });
  if (lines.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[router] ${lines.join(" ")}` } }));
} catch (e) {
  log({ error: e.name === "AbortError" ? `timeout ${cfg.jevTimeoutMs}ms` : String(e.message || e), ms: Date.now() - t0, prompt: prompt.slice(0, 120) });
}
process.exit(0);
