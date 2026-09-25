#!/usr/bin/env node
// Hard gates of /ship — facts checked by code, not by asking the model to remember.
// Active only when the current worktree has a /ship state (.claude/ship/<T>/state.json); otherwise it never interferes.
//
//  SubagentStop (implementer*): the final report must contain "Status: done|partial|blocked", "Tests: … failed 0" and
//    "Lint: clean". "done" with red tests/lint or a missing format is sent back ONCE (decision: block, with the reason)
//    so the implementer fixes or downgrades to partial; the result is written to state.implement_result for the lead.
//  PreToolUse Bash: `glab mr create` needs verdicts.code = APPROVE (the code review gate) · `git push` needs the same,
//    or an MR already open (fix rounds after the MR) · both need the branch rebased on origin/main with a fetch less
//    than 15 min old (the sync gate). Anything else passes.
//  PostToolUse Bash: a successful `glab mr create` writes state.mr {iid,url,draft} and moves the stage to pipeline, so
//    the MR is in the state even when the lead forgets to record it.
//  PreToolUse Agent|Task: no new subagent while the ticket is over budget (state.cost_usd, kept live by the statusline).
// Fail-open on internal errors. Log: logs/ship-gates.jsonl
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "ship-gates.jsonl");
const log = (o) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} };
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const git = (a, cwd) => { try { return execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };

let d = {}; try { d = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const cwd = d.cwd || process.cwd();
const root = git("rev-parse --show-toplevel", cwd); if (!root) process.exit(0);
const branchTicket = (git("rev-parse --abbrev-ref HEAD", cwd).match(/[A-Z][A-Z0-9]+-\d+/) || [])[0];
function findState() {
  const dir = path.join(root, ".claude", "ship"); let ds = []; try { ds = fs.readdirSync(dir).filter((x) => fs.existsSync(path.join(dir, x, "state.json"))); } catch { return null; }
  // The state of THIS worktree only: the ticket in the branch name, or a state whose `worktree` is this root. A stray
  // state in the main tree (a ticket that was cleaned by hand) must never gate a session on main.
  let pick = ds.includes(branchTicket) ? branchTicket : null;
  if (!pick) for (const t of ds) { try { const st = JSON.parse(fs.readFileSync(path.join(dir, t, "state.json"), "utf8")); if (st.worktree === root && !/^(main|master)$/.test(git("rev-parse --abbrev-ref HEAD", cwd))) { pick = t; break; } } catch {} }
  if (!pick) return null;
  try { return { file: path.join(dir, pick, "state.json"), s: JSON.parse(fs.readFileSync(path.join(dir, pick, "state.json"), "utf8")) }; } catch { return null; }
}
const st = findState(); if (!st) process.exit(0);
const save = () => { st.s.updated = new Date().toISOString(); fs.writeFileSync(st.file, JSON.stringify(st.s, null, 2) + "\n"); };
const hist = (event, note) => { st.s.history = st.s.history || []; st.s.history.push({ ts: new Date().toISOString(), stage: st.s.stage, event, ...(note ? { note: String(note).slice(0, 300) } : {}) }); };

if (d.hook_event_name === "SubagentStop") {
  if (!/^implementer/.test(String(d.agent_type || ""))) process.exit(0);
  if (st.s.stage !== "implement") process.exit(0);
  // last assistant text of the subagent
  let text = d.last_assistant_message || "";
  if (!text && d.agent_transcript_path) { try { for (const l of fs.readFileSync(d.agent_transcript_path, "utf8").split("\n")) { try { const e = JSON.parse(l); if (e.type === "assistant") { const t = (e.message?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"); if (t.trim()) text = t; } } catch {} } } catch {} }
  const status = (text.match(/^\s*Status:\s*(done|partial|blocked)/im) || [])[1]?.toLowerCase() || null;
  const tests = text.match(/^\s*Tests:.*$/im)?.[0] || null;
  const failed = tests ? Number((tests.match(/failed\s+(\d+)/i) || [])[1] ?? NaN) : NaN;
  const lintClean = /\bLint:\s*clean/i.test(text);
  const ok = status === "done" && failed === 0 && lintClean;
  const already = !!d.stop_hook_active || (st.s.implement_result?.blocked_once === true);
  st.s.implement_result = { ts: new Date().toISOString(), agent: d.agent_type, status, tests, failed: Number.isNaN(failed) ? null : failed, lint_clean: lintClean, ok, blocked_once: already };
  let reason = null;
  if (!status) reason = "Your final message must follow the output format exactly: `Status: done | partial | blocked`, `Branch:`, `Changed:`, `Tests: <command> → passed X / failed Y`, `Lint: clean | N issues`, `Notes:`. Re-send it in that format.";
  else if (status === "done" && !(failed === 0)) reason = `You reported Status: done but the Tests line is "${tests || "missing"}". Either make the tests pass (failed 0) and report again, or report Status: partial with what fails.`;
  else if (status === "done" && !lintClean) reason = "You reported Status: done but Lint is not clean. Fix the lint issues (or report Status: partial and list them).";
  if (reason && !already) { st.s.implement_result.blocked_once = true; hist("gate implement: blocked once", reason); save(); log({ gate: "implement", ticket: st.s.ticket, action: "block", status, failed, lintClean }); out({ decision: "block", reason: `ship-gate: ${reason}` }); }
  hist(ok ? "gate implement: pass" : `gate implement: fail (${status || "no format"})`, tests); save();
  log({ gate: "implement", ticket: st.s.ticket, action: ok ? "pass" : "fail", status, failed, lintClean, already });
  process.exit(0);
}

// Budget gate: no new subagent when the ticket is over budget (cost written by the statusline every tick, and by
// `ship-state cost`). The lead raises it explicitly: /ship <T> --budget <usd>. A STOP already recorded lets it through
// (the user is being asked); so does an explicit override in state.json (budget_override: true).
if (d.hook_event_name === "PreToolUse" && /^(Agent|Task)$/.test(d.tool_name || "")) {
  const cost = Number(st.s.cost_usd || 0), budget = Number(st.s.budget_usd || 0);
  if (budget > 0 && cost > budget && !st.s.budget_override && !st.s.stopped) {
    hist("budget: launch denied", `$${cost.toFixed(2)} > $${budget}`); save(); log({ gate: "budget", ticket: st.s.ticket, action: "deny", cost, budget });
    out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `ship-gate: ${st.s.ticket} is over budget ($${cost.toFixed(2)} of $${budget}). STOP and ask the user; to continue they say the new budget: node ~/.claude/tools/ship-state.mjs set ${st.s.ticket} budget_usd=<usd>` } });
  }
  process.exit(0);
}

if (d.hook_event_name === "PreToolUse" && d.tool_name === "Bash") {
  const cmd = String(d.tool_input?.command || "");
  const isCreate = /\bglab\s+mr\s+create\b/.test(cmd), isPush = /\bgit\s+push\b/.test(cmd);
  if (!isCreate && !isPush) process.exit(0);
  const approved = st.s.verdicts?.code?.verdict === "APPROVE";
  const mrOpen = !!st.s.mr?.iid;
  // Sync gate: a branch behind origin/main is never pushed or turned into an MR — rebase first. Uses the local
  // origin/main ref; if it has not been fetched in the last 15 minutes the answer could be stale, so ask for a fetch.
  const main = (git("symbolic-ref -q --short refs/remotes/origin/HEAD", cwd) || "origin/main").replace(/^origin\//, "");
  let fetchedAgo = Infinity; try { fetchedAgo = (Date.now() - fs.statSync(path.join(root, ".git", "FETCH_HEAD")).mtimeMs) / 60000; } catch { try { fetchedAgo = (Date.now() - fs.statSync(path.join(git("rev-parse --git-common-dir", cwd), "FETCH_HEAD")).mtimeMs) / 60000; } catch {} }
  const behind = Number(git(`rev-list --count HEAD..origin/${main}`, cwd) || 0);
  if (!/--force/.test(cmd) && (behind > 0 || fetchedAgo > 15)) { log({ gate: "sync", ticket: st.s.ticket, action: "deny", behind, fetchedAgo: Math.round(fetchedAgo), cmd: cmd.slice(0, 120) });
    out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: behind > 0
      ? `ship-gate: ${st.s.ticket} is ${behind} commit(s) behind origin/${main}. Rebase first: bash ~/.claude/tools/sync-check.sh --fix (then push with --force-with-lease if the branch was already pushed).`
      : `ship-gate: origin/${main} was last fetched ${Math.round(fetchedAgo)} min ago — run bash ~/.claude/tools/sync-check.sh (fetches and checks) and retry.` } }); }
  if (isCreate && !approved) { log({ gate: "open-mr", ticket: st.s.ticket, action: "deny", cmd: cmd.slice(0, 120) }); out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `ship-gate: no code-review APPROVE recorded for ${st.s.ticket} (verdicts.code = ${JSON.stringify(st.s.verdicts?.code || null)}). Run the review-code stage first. If a reviewer already returned APPROVE on the current commits in this session, record it: node ~/.claude/tools/ship-state.mjs verdict ${st.s.ticket} code APPROVE` } }); }
  if (isPush && !approved && !mrOpen) { log({ gate: "push", ticket: st.s.ticket, action: "deny", cmd: cmd.slice(0, 120) }); out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `ship-gate: pushing ${st.s.ticket} needs a code-review APPROVE (or an MR already open). Current stage: ${st.s.stage}. If a reviewer already returned APPROVE on the current commits in this session, record it: node ~/.claude/tools/ship-state.mjs verdict ${st.s.ticket} code APPROVE — otherwise run the review-code stage.` } }); }
  log({ gate: isCreate ? "open-mr" : "push", ticket: st.s.ticket, action: "allow" });
  process.exit(0);
}

// PostToolUse Bash: facts the lead tends to forget to record. `glab mr create` succeeded ⇒ state.mr + stage pipeline.
if (d.hook_event_name === "PostToolUse" && d.tool_name === "Bash") {
  const cmd = String(d.tool_input?.command || ""); if (!/\bglab\s+mr\s+create\b/.test(cmd)) process.exit(0);
  const resp = d.tool_response; const text = typeof resp === "string" ? resp : [resp?.stdout, resp?.stderr, resp?.output].filter(Boolean).join("\n");
  const m = text.match(/https?:\/\/[^\s"]+\/merge_requests\/(\d+)/); if (!m) process.exit(0);
  if (st.s.mr?.iid === Number(m[1])) process.exit(0);
  st.s.mr = { iid: Number(m[1]), url: m[0], draft: /--draft\b/.test(cmd) };
  const idx = ["prepare", "understand", "plan", "review-plan", "gate-human", "implement", "review-code", "stop-mr", "open-mr", "pipeline"];
  if (idx.includes(st.s.stage)) { hist(`stage ${st.s.stage} → pipeline`, "recorded by hook: glab mr create succeeded"); st.s.stage = "pipeline"; st.s.stopped = null; }
  hist(`mr !${m[1]} recorded`, m[0]); save(); log({ gate: "open-mr", ticket: st.s.ticket, action: "recorded", mr: m[1] });
  process.exit(0);
}
process.exit(0);
