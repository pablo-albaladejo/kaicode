#!/usr/bin/env node
// plan-state: the on-disk state behind /plan (refine an epic whose tickets already exist into one reviewed spec, with a
// section per ticket that /ship later implements). One file per epic in the MAIN checkout (not a worktree):
//   <main repo>/.claude/plan/<KEY>/state.json          (excluded from git via .git/info/exclude)
//   plan-state init <KEY> [--slug s]        create (idempotent)
//   plan-state get <KEY>                    full JSON
//   plan-state stage <KEY> <stage> [note]   move to a stage (history kept)
//   plan-state set <KEY> <path>=<json|str>  e.g. tickets='["APR-1","APR-2"]' spec=openspec/changes/x verdict=APPROVE
//   plan-state stop <KEY> <reason>          mark a human STOP · stopped=null clears it
//   plan-state status <KEY>                 one line: plan:APR-9 shape 6 tickets spec✓ review✗
//   plan-state attempt <KEY> <gate>         increment; exit 2 above 2 attempts (→ STOP)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const STAGES = ["prepare", "understand", "gate-facts", "shape", "review-spec", "gate-human", "publish", "done"];
const git = (a, cwd) => { try { return execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const die = (m, c = 1) => { console.error("plan-state: " + m); process.exit(c); };
const now = () => new Date().toISOString();
const top = git("rev-parse --show-toplevel") || die("not inside a git repository");
const common = git("rev-parse --git-common-dir"); const root = common ? path.dirname(path.resolve(top, common)) : top;   // main checkout
const file = (k) => path.join(root, ".claude", "plan", k, "state.json");
const load = (k) => { try { return JSON.parse(fs.readFileSync(file(k), "utf8")); } catch { die(`no state for ${k} (run: plan-state init ${k})`); } };
const save = (s) => { s.updated = now(); fs.mkdirSync(path.dirname(file(s.key)), { recursive: true }); fs.writeFileSync(file(s.key), JSON.stringify(s, null, 2) + "\n"); };
const hist = (s, event, note) => { s.history.push({ ts: now(), stage: s.stage, event, ...(note ? { note: String(note).slice(0, 300) } : {}) }); };
const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };
const setPath = (o, p, v) => { const ks = p.split("."); let c = o; for (const k of ks.slice(0, -1)) { c[k] = typeof c[k] === "object" && c[k] ? c[k] : {}; c = c[k]; } c[ks.at(-1)] = v; };
const exclude = () => { try { const ex = path.join(path.resolve(top, common || ".git"), "info", "exclude"); const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : ""; if (!cur.includes(".claude/plan/")) fs.appendFileSync(ex, "\n.claude/plan/\n"); } catch {} };

const [cmd, key, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "init": {
    if (!key) die("usage: plan-state init <KEY> [--slug s]");
    if (fs.existsSync(file(key))) { const s = load(key); console.log(`exists: ${key} at stage ${s.stage}${s.stopped ? ` (stopped: ${s.stopped})` : ""}`); break; }
    const i = rest.indexOf("--slug"); const slug = i >= 0 ? rest[i + 1] : null;
    save({ key, slug, root, created: now(), stage: "prepare", tickets: [], spec: null, verdict: null, attempts: {}, stopped: null, facts: [], gaps: [], history: [] }); exclude();
    console.log(`created ${file(key)}`); break;
  }
  case "get": console.log(JSON.stringify(load(key), null, 2)); break;
  case "stage": { const s = load(key), st = rest[0]; if (!STAGES.includes(st)) die(`unknown stage ${st}; one of ${STAGES.join(" ")}`);
    hist(s, "stage", `${s.stage} → ${st}${rest[1] ? ": " + rest.slice(1).join(" ") : ""}`); s.stage = st; save(s); console.log(`${key}: → ${st}`); break; }
  case "set": { const s = load(key); for (const kv of rest) { const i = kv.indexOf("="); if (i < 1) die(`bad assignment ${kv}`); setPath(s, kv.slice(0, i), parseVal(kv.slice(i + 1))); hist(s, "set", kv.slice(0, 80)); } save(s); console.log("ok"); break; }
  case "stop": { const s = load(key); s.stopped = rest.join(" ") || "human decision needed"; hist(s, "stop", s.stopped); save(s); console.log(`STOP recorded at ${s.stage}: ${s.stopped}`); break; }
  case "attempt": { const s = load(key), g = rest[0] || die("usage: attempt <KEY> <gate>"); s.attempts[g] = (s.attempts[g] || 0) + 1; save(s); console.log(s.attempts[g]); if (s.attempts[g] > 2) process.exit(2); break; }
  case "status": { const s = load(key); console.log(`plan:${key} ${s.stage} ${s.tickets.length} ticket(s) spec${s.spec ? "✓" : "-"} review${s.verdict === "APPROVE" ? "✓" : s.verdict ? "✗" : "-"}${s.stopped ? ` STOP: ${s.stopped}` : ""}`); break; }
  default: console.log("usage: plan-state init|get|stage|set|stop|attempt|status <KEY> … (see the header)"); process.exit(cmd ? 1 : 0);
}
