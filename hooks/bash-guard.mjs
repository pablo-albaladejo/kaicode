#!/usr/bin/env node
// PreToolUse hook on Bash — a safety net behind the deny rules. Commands that look harmless (git status, ls, tests,
// glab mr view …) pass without any call. Commands with risky tokens (rm, push, reset, mv, chmod, aws/kubectl/terraform
// writes, glab writes, redirections, sudo, curl -X …) are classified by Jev as read | write | destructive:
// destructive → deny (the agent gets the reason and must ask the user); write → allow; read → allow.
// Destructive is deliberately narrow: unrecoverable loss of shared work, or a decision taken for the user (MR approve/
// merge/close). After the user says "run it", the agent re-runs the command prefixed with `CC_CONFIRMED=1 ` (logged).
// Only in plain `claude` sessions (aircode sessions skipped). Never blocks on its own errors (fail-open → allow).
// Config in router.json: bashGuardMode "on"|"off" (default on), bashGuardMinConfidence (0.6).
// Log: logs/bash-guard.jsonl · Report: node ~/.claude/hooks/bash-guard.mjs --report [days]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "bash-guard.jsonl");
const DEFAULTS = { bashGuardMode: "on", bashGuardMinConfidence: 0.6, jevUrl: "https://api.llmgateway.io/v1/systemone", jevModel: "jev-1.13.0", jevKeyEnv: "JEV_LLMGATEWAY_KEY", jevTimeoutMs: 4000 };
let cfg = DEFAULTS; try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")) }; } catch {}
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} };

// Tokens that make a command worth a look. Anything else passes silently.
const RISKY = /(^|[\s;&|(])(rm|rmdir|unlink|mv|chmod|chown|truncate|dd|mkfs|shred|sudo|kill|pkill|killall)\b|git\s+(push|reset|clean|branch\s+-[dD]|checkout\s+--|restore|rebase|filter-branch|update-ref|reflog\s+expire|gc|stash\s+(drop|clear)|worktree\s+remove|remote\s+(remove|rm)|tag\s+-d)|glab\s+(mr\s+(approve|merge|close|update|delete|note|rebase)|repo\s+(delete|archive)|issue\s+(close|delete)|release\s+delete|variable\s+(set|delete)|api\s+.*-X\s*(POST|PUT|DELETE|PATCH))|aws\s+(?!sts\b|.*\b(describe|list|get)-)|kubectl\s+(delete|apply|patch|scale|rollout|exec|drain|cordon)|terraform\s+(apply|destroy|import|state\s+(rm|mv|push))|docker\s+(rm|rmi|system\s+prune|kill)|npm\s+(publish|unpublish|deprecate)|curl\s+.*-X\s*(POST|PUT|DELETE|PATCH)|(^|[^>])>\s*\/|>\s*~|\bacli\b.*\b(delete|transition|assign|close)\b/i;

if (process.argv[2] === "--report") {
  const days = Number(process.argv[3] || 7), since = Date.now() - days * 86400000;
  let rows = []; try { rows = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => new Date(r.ts).getTime() >= since); } catch {}
  const by = (k) => [...rows.reduce((m, r) => m.set(r[k] ?? "-", (m.get(r[k] ?? "-") || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  console.log(`Bash guard — last ${days} days — ${rows.length} risky commands checked: ${by("verdict")}`);
  for (const r of rows.filter((r) => r.verdict === "destructive").slice(-8)) console.log(`  DENIED ${r.ts.slice(5, 16).replace("T", " ")}  ${(r.command || "").slice(0, 90)}`);
  const er = rows.filter((r) => r.error); if (er.length) console.log("  errors: " + [...new Set(er.map((r) => r.error))].join(" | "));
  process.exit(0);
}

let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const cmd = String(input.tool_input?.command || "");
if (cfg.bashGuardMode === "off" || !cmd) process.exit(0);
if (process.env.AIRCODE_SESSION_METADATA_PATH || /aircall-aircode-agents/.test(process.env.CLAUDE_CODE_AGENT || "")) process.exit(0);
// code-write (cheap model writes a file to disk) is only for implementer variants on pro/sol: everyone else is denied.
if (/code-write\.mjs/.test(cmd) && !/--report/.test(cmd)) {
  const allowed = new RegExp(cfg.codeWriteAgents || "^implementer--(pro|sol)-");
  if (!allowed.test(String(input.agent_type || "main"))) {
    log({ command: cmd.slice(0, 300), verdict: "destructive", confidence: 1, reason: "code-write not allowed for this agent", agent: input.agent_type || "main" });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: `bash-guard: code-write is only available to implementer variants on pro/sol (you are ${input.agent_type || "main"}). Write the file yourself with Write/Edit, or delegate the change.` } }));
    process.exit(0);
  }
}
if (/^\s*CC_CONFIRMED=1\s/.test(cmd)) { log({ command: cmd.slice(0, 300), verdict: "confirmed", agent: input.agent_type || "main" }); process.exit(0); } // user said "run it"
// --force-with-lease on a feature branch is how a rebased branch is pushed: a write, not a loss (the lease refuses to
// overwrite what someone else pushed). Only main/master and a bare --force stay with the classifier.
if (/\bgit\s+push\b[^|;&]*--force-with-lease/.test(cmd) && !/\bgit\s+push\b[^|;&]*(\s--force(\s|$)|\s-f(\s|$))/.test(cmd) && !/\b(main|master)\b/.test(cmd)) { log({ command: cmd.slice(0, 300), verdict: "write", confidence: 1, reason: "force-with-lease on a feature branch", agent: input.agent_type || "main" }); process.exit(0); }
// Starting work on a ticket moves it to In Progress: the one Jira transition the loop does on its own (ship.md stage 1).
if (/\bacli\s+jira\s+workitem\s+transition\b[^|;&]*--status\s+["']?In Progress["']?/.test(cmd)) { log({ command: cmd.slice(0, 300), verdict: "write", confidence: 1, reason: "ticket → In Progress at /ship start", agent: input.agent_type || "main" }); process.exit(0); }
if (!RISKY.test(cmd)) process.exit(0);
const key = process.env[cfg.jevKeyEnv]; if (!key) { log({ command: cmd.slice(0, 300), error: "no key", verdict: "allow" }); process.exit(0); }

const body = {
  model: cfg.jevModel,
  state: { command: cmd.slice(0, 1500), cwd: input.cwd ? path.basename(input.cwd) : "", agent: input.agent_type || "main" },
  questions: { effect: { type: "choice",
    instructions: "A coding agent wants to run this shell command inside a git worktree of a company repository. Classify its worst plausible effect. Only two things are 'destructive': (1) losing work that cannot be recovered from the reflog or a remote — a bare --force push, rewriting history of main or of another person's branch, deleting remote branches, pushing to main (note: git push --force-with-lease on the author's own feature branch after a rebase is a normal 'write'), rm -rf outside the worktree or on the home directory, deleting production data or infrastructure; (2) acting on the user's behalf on a merge request or ticket in a way others see as a decision — approving, merging, or closing an MR, transitioning a ticket. Everything else is 'write' or 'read': deleting or editing the agent's own MR notes, labels, local branches, files inside the worktree, installs, cache cleanup, cloud reads.",
    criteria: { read: "Reads state only: status, logs, listings, diffs, builds, tests, dry runs",
                write: "Recoverable change: commits, local branch work, pushes to a feature branch, MR notes or labels (create, edit, delete), installs, moves or deletes inside the worktree, cache cleanup",
                destructive: "Unrecoverable loss of shared work (force push / history rewrite of a remote branch, remote branch deletion, push to main, rm -rf outside the worktree, deleting production data or infra) or a decision taken for the user (MR approve / merge / close, ticket transition)" } } },
};
const t0 = Date.now();
try {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.jevTimeoutMs);
  const res = await fetch(cfg.jevUrl, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  clearTimeout(timer);
  if (!res.ok) { log({ command: cmd.slice(0, 300), error: `HTTP ${res.status}`, verdict: "allow" }); process.exit(0); }
  const a = (await res.json()).answers?.effect;
  const verdict = a?.choice, conf = a?.confidence ?? 0;
  log({ command: cmd.slice(0, 300), verdict, confidence: conf, probabilities: a?.probabilities, ms: Date.now() - t0, agent: input.agent_type || "main" });
  if (verdict === "destructive" && conf >= cfg.bashGuardMinConfidence) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: `bash-guard: denied (${conf.toFixed(2)}) — this can lose shared work or takes a decision for the user (MR approve/merge/close). Show the user the exact command and why; they run it themselves, or say "run it" and you re-run it once prefixed with CC_CONFIRMED=1 (never without their words).` } }));
  }
} catch (e) { log({ command: cmd.slice(0, 300), error: e.name === "AbortError" ? `timeout ${cfg.jevTimeoutMs}ms` : String(e.message || e), verdict: "allow" }); }
process.exit(0);
