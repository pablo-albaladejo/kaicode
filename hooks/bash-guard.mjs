#!/usr/bin/env node
// PreToolUse hook on Bash — a safety net behind the deny rules. Commands that look harmless (git status, ls, tests,
// glab mr view …) pass without any call. Commands with risky tokens (rm, push, reset, mv, chmod, aws/kubectl/terraform
// writes, glab writes, redirections, sudo, curl -X …) are classified by Jev as read | write | destructive:
// destructive → deny (the agent gets the reason and must ask the user); write → allow; read → allow.
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
if (!RISKY.test(cmd)) process.exit(0);
const key = process.env[cfg.jevKeyEnv]; if (!key) { log({ command: cmd.slice(0, 300), error: "no key", verdict: "allow" }); process.exit(0); }

const body = {
  model: cfg.jevModel,
  state: { command: cmd.slice(0, 1500), cwd: input.cwd ? path.basename(input.cwd) : "", agent: input.agent_type || "main" },
  questions: { effect: { type: "choice",
    instructions: "A coding agent wants to run this shell command inside a git worktree of a company repository. Classify its worst plausible effect. 'destructive' means it can lose work or affect shared state: deleting files outside build artifacts, rewriting or deleting git history or branches, force pushes, pushing to main, changing cloud or CI resources, approving/merging/closing merge requests, deleting data. Plain reads, builds, tests, and edits confined to the working tree are not destructive.",
    criteria: { read: "Reads state only: status, logs, listings, diffs, builds, tests, dry runs",
                write: "Changes the working tree or local state in a recoverable way: commits, local branch work, installs, file moves inside the repo, cache cleanup",
                destructive: "Can lose work or change shared/remote state: rm -rf on source or home, git push --force / to main, history rewrite, branch deletion, cloud/CI/infra mutations, MR approve/merge/close, data deletion" } } },
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
      permissionDecisionReason: `bash-guard: this command was classified as destructive (${conf.toFixed(2)}): it can lose work or change shared state. Do not retry variants of it. Tell the user what you wanted to run and why, and let them run it or confirm explicitly.` } }));
  }
} catch (e) { log({ command: cmd.slice(0, 300), error: e.name === "AbortError" ? `timeout ${cfg.jevTimeoutMs}ms` : String(e.message || e), verdict: "allow" }); }
process.exit(0);
