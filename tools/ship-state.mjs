#!/usr/bin/env node
// ship-state: the on-disk state machine behind /ship. One file per ticket, inside the worktree:
//   <repo>/.claude/ship/<TICKET>/state.json      (excluded from git via .git/info/exclude)
// The lead runs this instead of "remembering": every transition, attempt, verdict and cost goes here, the hard
// gates (hooks/ship-gates.mjs) read it, and /ship resumes from it after a compaction or a new session.
//
//   ship-state init <T> [--slug s]          create (idempotent) · records worktree, branch, repo, budget
//   ship-state get [T]                      full JSON (T defaults to the ticket of the current worktree)
//   ship-state stage <T> <stage> [note]     move to a stage (history kept)
//   ship-state set <T> <path>=<json|str> …  set fields: plan.risk=high acceptance='["a","b"]' mr.iid=203
//   ship-state attempt <T> <gate>           increment; prints the count; exit 2 when it exceeds the cap (→ STOP)
//   ship-state verdict <T> <gate> <V>       record a review verdict (plan|code|mr): APPROVE | REQUEST CHANGES | …
//   ship-state cost <T> [usd]               set (or recompute with cc-cost --ticket) the spend; exit 2 over budget
//   ship-state stop <T> <reason>            mark a human STOP (what the user must answer)
//   ship-state status [T] [--json]          one line for the HUD / the lead:  ship:APR-1 implement#2 $1.2/5 plan✓ code✗ mr:-
//   ship-state list                         tickets with state in this repo
//   ship-state reset <T>                    archive state.json as state.<ts>.json and start over
// Config in ~/.claude/router.json: shipBudgetUsd (5), shipMaxAttempts (2).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")); } catch {}
const BUDGET = Number(cfg.shipBudgetUsd ?? 5), MAX = Number(cfg.shipMaxAttempts ?? 2);
const STAGES = ["prepare", "understand", "plan", "review-plan", "gate-human", "implement", "review-code", "stop-mr", "open-mr", "pipeline", "review-mr", "close", "ready-for-merge"];
const git = (a, cwd) => { try { return execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const die = (m, code = 1) => { console.error("ship-state: " + m); process.exit(code); };
const now = () => new Date().toISOString();

const root = git("rev-parse --show-toplevel") || die("not inside a git repository");
const DIR = path.join(root, ".claude", "ship");
const file = (t) => path.join(DIR, t, "state.json");
const ticketFromBranch = () => (git("rev-parse --abbrev-ref HEAD").match(/[A-Z][A-Z0-9]+-\d+/) || [])[0] || null;
const resolveTicket = (t) => {
  if (t && t !== "-") return t;
  const b = ticketFromBranch(); if (b && fs.existsSync(file(b))) return b;
  let ds = []; try { ds = fs.readdirSync(DIR).filter((d) => fs.existsSync(file(d))); } catch {}
  if (ds.length === 1) return ds[0];
  if (b) return b;
  die("no ticket given and none inferable from the branch or .claude/ship/");
};
const load = (t) => { try { return JSON.parse(fs.readFileSync(file(t), "utf8")); } catch { die(`no state for ${t} (run: ship-state init ${t})`); } };
const save = (s) => { s.updated = now(); fs.mkdirSync(path.dirname(file(s.ticket)), { recursive: true }); fs.writeFileSync(file(s.ticket), JSON.stringify(s, null, 2) + "\n"); };
const hist = (s, event, note) => { s.history.push({ ts: now(), stage: s.stage, event, ...(note ? { note: String(note).slice(0, 300) } : {}) }); if (s.history.length > 200) s.history = s.history.slice(-200); };
const setPath = (o, p, v) => { const ks = p.split("."); let c = o; for (const k of ks.slice(0, -1)) { c[k] = typeof c[k] === "object" && c[k] ? c[k] : {}; c = c[k]; } c[ks.at(-1)] = v; };
const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };
const excludeFromGit = () => { try { const ex = path.join(git("rev-parse --git-common-dir") || ".git", "info", "exclude"); const abs = path.isAbsolute(ex) ? ex : path.join(root, ex); const cur = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""; if (!/^\.claude\/ship\/?$/m.test(cur)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.appendFileSync(abs, (cur.endsWith("\n") || !cur ? "" : "\n") + ".claude/ship/\n"); } } catch {} };

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); if (i < 0) return null; const v = rest[i + 1]; rest.splice(i, 2); return v; };

switch (cmd) {
  case "init": {
    const t = rest[0] || die("usage: ship-state init <TICKET> [--slug s]"); const slug = flag("--slug");
    if (fs.existsSync(file(t))) { const s = load(t); console.log(`exists: ${t} at stage ${s.stage} (attempts ${JSON.stringify(s.attempts)})`); break; }
    const s = { ticket: t, slug: slug || null, created: now(), updated: now(), stage: "prepare", repo: path.basename(root), worktree: root, branch: git("rev-parse --abbrev-ref HEAD"),
      budget_usd: BUDGET, max_attempts: MAX, cost_usd: 0, attempts: { "review-plan": 0, "review-code": 0, pipeline: 0, understand: 0 },
      acceptance: [], plan: null, spec: null, verdicts: { plan: null, code: null, mr: null }, mr: null, pipeline: null, lessons: [], stopped: null, history: [] };
    hist(s, "init"); save(s); excludeFromGit(); console.log(`initialised ${t} in ${path.relative(root, file(t))}`); break;
  }
  case "get": { console.log(JSON.stringify(load(resolveTicket(rest[0])), null, 2)); break; }
  case "stage": {
    const t = resolveTicket(rest[0]); const st = rest[1] || die("usage: ship-state stage <T> <stage> [note]");
    if (!STAGES.includes(st)) die(`unknown stage ${st}; one of ${STAGES.join(" ")}`);
    const s = load(t); const from = s.stage;
    // duration of the stage we are leaving (since it was entered, minus nothing: human waits are recorded as their own stages)
    const entered = [...s.history].reverse().find((h) => h.event && h.event.endsWith(`→ ${from}`))?.ts || (from === "prepare" ? s.created : null);
    const seconds = entered ? Math.round((Date.now() - new Date(entered).getTime()) / 1000) : null;
    s.stage = st; s.stopped = null; hist(s, `stage ${from} → ${st}`, rest.slice(2).join(" ")); save(s);
    if (from !== st) try { const L = path.join(CFG_DIR, "logs", "ship-stages.jsonl"); fs.mkdirSync(path.dirname(L), { recursive: true }); fs.appendFileSync(L, JSON.stringify({ ts: now(), ticket: t, repo: s.repo, stage: from, to: st, seconds, attempts: s.attempts[from] ?? null }) + "\n"); } catch {}
    console.log(`${t}: ${from} → ${st}${seconds != null ? ` (${from} took ${Math.round(seconds / 60)}m)` : ""}`); break;
  }
  case "set": {
    const t = resolveTicket(rest[0]); const s = load(t);
    for (const kv of rest.slice(1)) { const i = kv.indexOf("="); if (i < 0) die(`bad assignment ${kv}`); setPath(s, kv.slice(0, i), parseVal(kv.slice(i + 1))); }
    hist(s, "set", rest.slice(1).map((x) => x.slice(0, 60)).join(" ")); save(s); console.log("ok"); break;
  }
  case "attempt": {
    const t = resolveTicket(rest[0]); const g = rest[1] || die("usage: ship-state attempt <T> <gate>"); const s = load(t);
    s.attempts[g] = (s.attempts[g] || 0) + 1; hist(s, `attempt ${g} #${s.attempts[g]}`); save(s);
    console.log(`${g} attempt ${s.attempts[g]}/${s.max_attempts}`);
    if (s.attempts[g] > s.max_attempts) { console.log(`STOP: ${g} failed ${s.attempts[g] - 1} times; a third automatic round is not allowed. Report the last findings and ask the user.`); process.exit(2); }
    break;
  }
  case "verdict": {
    const t = resolveTicket(rest[0]); const g = rest[1], v = rest.slice(2).join(" "); if (!["plan", "code", "mr"].includes(g) || !v) die("usage: ship-state verdict <T> plan|code|mr <VERDICT>");
    const s = load(t); s.verdicts[g] = { verdict: v.toUpperCase(), ts: now() }; hist(s, `verdict ${g}: ${v}`); save(s); console.log(`${g}: ${v}`); break;
  }
  case "cost": {
    const t = resolveTicket(rest[0]); const s = load(t);
    let usd = rest[1] != null ? Number(rest[1]) : null;
    if (usd == null) { try { const out = execSync(`node ${path.join(CFG_DIR, "tools", "cc-cost.mjs")} --ticket ${t} --days 30 --all --json`, { stdio: ["ignore", "pipe", "ignore"] }).toString(); usd = Number(JSON.parse(out).cost || 0); } catch { die("could not compute cost (cc-cost --ticket); pass the amount explicitly"); } }
    s.cost_usd = Math.round(usd * 10000) / 10000; hist(s, `cost ${s.cost_usd}`); save(s);
    console.log(`$${s.cost_usd.toFixed(3)} of $${s.budget_usd}`);
    if (s.cost_usd > s.budget_usd) { console.log(`STOP: over budget ($${s.cost_usd.toFixed(2)} > $${s.budget_usd}). Ask the user before continuing; to continue run: ship-state set ${t} budget_usd=<new>`); process.exit(2); }
    break;
  }
  case "stop": { const t = resolveTicket(rest[0]); const s = load(t); s.stopped = { ts: now(), stage: s.stage, reason: rest.slice(1).join(" ") || "human decision needed" }; hist(s, "STOP", s.stopped.reason); save(s); console.log(`STOP recorded at ${s.stage}: ${s.stopped.reason}`); break; }
  case "status": {
    const json = rest.includes("--json"); const t = resolveTicket(rest.find((x) => !x.startsWith("--")));
    if (!fs.existsSync(file(t))) { if (json) console.log("null"); process.exit(0); }
    const s = load(t); const v = (k) => (s.verdicts[k]?.verdict === "APPROVE" ? "✓" : s.verdicts[k] ? "✗" : "-");
    const stageAttempt = { "review-plan": s.attempts["review-plan"], implement: s.attempts["review-code"], "review-code": s.attempts["review-code"], pipeline: s.attempts.pipeline }[s.stage];
    const line = `ship:${s.ticket} ${s.stage}${stageAttempt ? "#" + (stageAttempt + 1) : ""} $${s.cost_usd.toFixed(2)}/${s.budget_usd} plan${v("plan")} code${v("code")} mr:${s.mr?.iid ? "!" + s.mr.iid : "-"}${s.pipeline?.status ? " ci:" + s.pipeline.status : ""}${s.stopped ? " STOP" : ""}`;
    if (json) console.log(JSON.stringify({ ...s, line })); else console.log(line); break;
  }
  case "list": { let ds = []; try { ds = fs.readdirSync(DIR).filter((d) => fs.existsSync(file(d))); } catch {} for (const d of ds) { const s = load(d); console.log(`${d.padEnd(12)} ${s.stage.padEnd(16)} $${s.cost_usd.toFixed(2)}  updated ${s.updated.slice(0, 16)}${s.stopped ? "  STOP: " + s.stopped.reason : ""}`); } break; }
  case "reset": { const t = rest[0] || die("usage: ship-state reset <T>"); if (fs.existsSync(file(t))) { fs.renameSync(file(t), file(t).replace(/state\.json$/, `state.${now().replace(/[:.]/g, "-")}.json`)); console.log(`archived; run: ship-state init ${t}`); } else console.log("nothing to reset"); break; }
  default: die("usage: ship-state init|get|stage|set|attempt|verdict|cost|stop|status|list|reset …");
}
