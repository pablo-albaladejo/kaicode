#!/usr/bin/env node
// Hard gates of /ship — facts checked by code, not by asking the model to remember.
// Active only when the current worktree has a /ship state (.claude/ship/<T>/state.json); otherwise it never interferes.
//
//  SubagentStop (implementer*): the final report must contain "Status: done|partial|blocked", "Tests: … failed 0" and
//    "Lint: clean". "done" with red tests/lint or a missing format is sent back ONCE (decision: block, with the reason)
//    so the implementer fixes or downgrades to partial; the result is written to state.implement_result for the lead.
//    "done" is also checked against facts: no --no-verify commit, test count not lower than the best earlier run,
//    a test file changed when source changed, and every new export used outside its file (or declared "unwired:").
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
  // Facts checked from the repo and the transcript, not from the report (retro 2026-10-14: "done" for code nobody
  // called, "passed 43" that were files, --no-verify commits).
  const passed = tests ? Number((tests.match(/passed\s+(\d+)/i) || [])[1] ?? NaN) : NaN;
  const facts = [];
  if (status === "done") {
    let cmds = [];
    if (d.agent_transcript_path) { try { for (const l of fs.readFileSync(d.agent_transcript_path, "utf8").split("\n")) { try { const e = JSON.parse(l); for (const b of e.message?.content || []) if (b.type === "tool_use" && b.name === "Bash") cmds.push(String(b.input?.command || "")); } catch {} } } catch {} }
    if (cmds.some((c) => /\bgit\b[^|;&]*\bcommit\b[^|;&]*--no-verify|HUSKY=0|SKIP_HOOKS=1/.test(c))) facts.push("you committed with --no-verify (or hooks disabled). Undo that commit (git reset --soft HEAD~1), make the pre-commit checks pass, and commit again without skipping hooks");
    const prev = Number(st.s.tests_max || 0);
    if (!Number.isNaN(passed) && prev && passed < prev) facts.push(`Tests says passed ${passed}, but an earlier run on this ticket passed ${prev}. Count TESTS, not test files (vitest: the "Tests  N passed" line), and run the same suite`);
    const base = git("merge-base origin/main HEAD", cwd) || git("merge-base origin/master HEAD", cwd);
    if (base) {
      const changed = git(`diff --name-only ${base}`, cwd).split("\n").filter(Boolean);
      const isTest = (f) => /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|test_[^/]+\.py$/.test(f);
      const isSrc = (f) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|cs|rs)$/.test(f) && !isTest(f) && !/(^|\/)(migrations?|generated|__generated__)\//.test(f);
      if (changed.some(isSrc) && !changed.some(isTest)) facts.push("source files changed on this branch but no test file was added or changed. Add the test that proves the step (see the plan's test: line)");
      const added = git(`diff -U0 ${base} -- ${changed.filter(isSrc).map((f) => `'${f.replace(/'/g, "")}'`).join(" ") || "."}`, cwd);
      const unwired = [];
      let curFile = null;
      for (const line of added.split("\n")) {
        const fm = line.match(/^\+\+\+ b\/(.+)$/); if (fm) { curFile = fm[1]; continue; }
        const m = line.match(/^\+\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]{2,})/);
        if (!m || !curFile) continue;
        const uses = git(`grep -lw -- ${m[1]}`, cwd).split("\n").filter((f) => f && f !== curFile && !isTest(f));
        if (!uses.length && !new RegExp(`unwired:[^\n]*\\b${m[1]}\\b`, "i").test(text)) unwired.push(`${m[1]} (${curFile})`);
      }
      if (unwired.length) facts.push(`new exports that nothing outside their file and tests uses: ${unwired.slice(0, 6).join(", ")}. Wire them where the plan says (wire:), or if that is a later step say so in Notes as "unwired: <name> — step <n>"`);
    }
  }
  if (!Number.isNaN(passed) && passed > Number(st.s.tests_max || 0) && failed === 0) st.s.tests_max = passed;
  const ok = status === "done" && failed === 0 && lintClean && !facts.length;
  const already = !!d.stop_hook_active || (st.s.implement_result?.blocked_once === true);
  st.s.implement_result = { ts: new Date().toISOString(), agent: d.agent_type, status, tests, failed: Number.isNaN(failed) ? null : failed, lint_clean: lintClean, facts, ok, blocked_once: already };
  let reason = null;
  if (!status) reason = "Your final message must follow the output format exactly: `Status: done | partial | blocked`, `Branch:`, `Changed:`, `Tests: <command> → passed X / failed Y`, `Lint: clean | N issues`, `Notes:`. Re-send it in that format.";
  else if (status === "done" && !(failed === 0)) reason = `You reported Status: done but the Tests line is "${tests || "missing"}". Either make the tests pass (failed 0) and report again, or report Status: partial with what fails.`;
  else if (status === "done" && !lintClean) reason = "You reported Status: done but Lint is not clean. Fix the lint issues (or report Status: partial and list them).";
  else if (facts.length) reason = `You reported Status: done, but the gate found: ${facts.map((f, i) => `(${i + 1}) ${f}`).join(" ")}. Fix these and report again, or report Status: partial and say what is left.`;
  if (reason && !already) { st.s.implement_result.blocked_once = true; hist("gate implement: blocked once", reason); save(); log({ gate: "implement", ticket: st.s.ticket, action: "block", status, failed, lintClean, facts: facts.length }); out({ decision: "block", reason: `ship-gate: ${reason}` }); }
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
  // origin/main ref; if it has not been fetched in the last 15 minutes the hook fetches it itself.
  const main = (git("symbolic-ref -q --short refs/remotes/origin/HEAD", cwd) || "origin/main").replace(/^origin\//, "");
  // FETCH_HEAD lives in the worktree-private git dir (.git/worktrees/<name>/) when fetching from a worktree and in the
  // common .git/ when fetching from the main checkout — look at both and take the freshest; missing = never fetched.
  let fetchedAgo = Infinity;
  for (const q of ["rev-parse --git-dir", "rev-parse --git-common-dir"]) { const dir = git(q, cwd); if (!dir) continue;
    try { const ago = (Date.now() - fs.statSync(path.join(path.resolve(cwd, dir), "FETCH_HEAD")).mtimeMs) / 60000; if (ago < fetchedAgo) fetchedAgo = ago; } catch {} }
  // A stale fetch is hygiene, not risk: fetch here (quiet, ≤ 8 s) instead of denying. Only a failed fetch still denies.
  if (fetchedAgo > 15) { try { execSync(`git fetch --quiet origin ${main}`, { cwd, stdio: "ignore", timeout: 8000 }); fetchedAgo = 0; } catch {} }
  const behind = Number(git(`rev-list --count HEAD..origin/${main}`, cwd) || 0);
  if (!/--force/.test(cmd) && (behind > 0 || fetchedAgo > 15)) { log({ gate: "sync", ticket: st.s.ticket, action: "deny", behind, fetchedAgo: Math.round(fetchedAgo), cmd: cmd.slice(0, 120) });
    out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: behind > 0
      ? `ship-gate: ${st.s.ticket} is ${behind} commit(s) behind origin/${main}. Rebase first: bash ~/.claude/tools/sync-check.sh --fix (then push with --force-with-lease if the branch was already pushed).`
      : `ship-gate: origin/${main} could not be fetched (network/VPN?) — run bash ~/.claude/tools/sync-check.sh and retry.` } }); }
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
