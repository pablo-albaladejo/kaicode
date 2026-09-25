#!/usr/bin/env node
// mr-feedback: what peers and bots said on an MR and is still open — the input of the /ship "feedback" stage.
//   node ~/.claude/tools/mr-feedback.mjs --mr <iid|!iid|url> [--json] [--all]     # open threads by others (+ approvals)
//   node ~/.claude/tools/mr-feedback.mjs --mr <iid> --reply <discussion_id> "<text>"   # answer in a thread (one note)
//   node ~/.claude/tools/mr-feedback.mjs --mr <iid> --resolve <discussion_id>           # mark a thread resolved
// Read-only unless --reply/--resolve. Uses glab api; project from the current repo unless --repo or a URL is given.
// A thread is listed when: not resolved, started by someone else (or a bot), not a system note, and the last note is
// not mine (i.e. still waiting on me). --all lists every unresolved thread by others, answered or not.
// Bots are detected by the author flag or by name (gitlab, security, sonar, renovate, dependabot, danger, codeowners,
// greptile, secgate, copilot, coderabbit, snyk). Non-resolvable bot notes (a "Security Gate PASSED" report) are not
// feedback and are skipped unless --all. Badges/images are turned into their alt text ([P1]).
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
let mr = opt("--mr") || ""; let repo = opt("--repo");
const u = mr.match(/^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/); if (u) { repo = repo || u[2]; mr = u[3]; if (!process.env.GITLAB_HOST) process.env.GITLAB_HOST = u[1]; }
mr = mr.replace(/^!/, ""); if (!/^\d+$/.test(mr)) { console.error("usage: mr-feedback --mr <iid|url> [--json|--all] | --reply <id> <text> | --resolve <id>"); process.exit(1); }
const project = repo ? encodeURIComponent(repo) : ":id";
const fail = (e, what) => { console.error(`mr-feedback: ${what} failed — ${String(e.stderr || e.message).replace(/\s+/g, " ").trim().slice(0, 240)}`); process.exit(2); };
const api = (p, extra = []) => { for (let attempt = 1; ; attempt++) { try { return JSON.parse(execFileSync("glab", ["api", p, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); }
  catch (e) { if (attempt < 3 && /timeout|EOF|reset|temporar|handshake/i.test(String(e.stderr || e.message))) { execFileSync("sleep", ["3"]); continue; } fail(e, `glab api ${p}`); } } };
const apiJson = (p, method, payload) => { try { return JSON.parse(execFileSync("glab", ["api", p, "-X", method, "-H", "Content-Type: application/json", "--input", "-"], { encoding: "utf8", input: JSON.stringify(payload), stdio: ["pipe", "pipe", "pipe"] })); } catch (e) { fail(e, `glab api ${method} ${p}`); } };
const base = `projects/${project}/merge_requests/${mr}`;

if (opt("--reply")) { const id = opt("--reply"), text = argv[argv.indexOf("--reply") + 2]; if (!text) { console.error("--reply <discussion_id> <text>"); process.exit(1); }
  const r = apiJson(`${base}/discussions/${id}/notes`, "POST", { body: text }); console.log(`replied in ${id}: note ${r.id}`); process.exit(0); }
if (opt("--resolve")) { const id = opt("--resolve"); const r = apiJson(`${base}/discussions/${id}`, "PUT", { resolved: true }); console.log(`resolved ${id}${r.notes?.[0]?.resolved ? "" : " (check: GitLab did not report resolved)"}`); process.exit(0); }

const me = api("user").username;
const info = api(base);
let approvals = null; try { approvals = api(`${base}/approvals`); } catch {}
let discussions = []; for (let page = 1; page < 50; page++) { const d = api(`${base}/discussions?per_page=100&page=${page}`); discussions = discussions.concat(d); if (d.length < 100) break; }
const isBot = (a) => !!(a?.bot || /bot|gitlab|security|sonar|renovate|dependabot|danger|codeowner|review|greptile|secgate|copilot|coderabbit|snyk/i.test(`${a?.username || ""} ${a?.name || ""}`));
const clean = (b) => String(b || "").replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "[$1]").replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const threads = [];
for (const d of discussions) {
  const notes = (d.notes || []).filter((n) => !n.system); if (!notes.length) continue;
  const first = notes[0], last = notes[notes.length - 1];
  if (first.author?.username === me) continue;                              // my own threads (e.g. mr-post findings) are not feedback
  const resolvable = notes.some((n) => n.resolvable), resolved = notes.every((n) => !n.resolvable || n.resolved);
  if (resolvable && resolved) continue;
  if (!resolvable && isBot(first.author) && !argv.includes("--all")) continue;   // informational bot notes (security gate PASSED…) are not feedback
  const waitingOnMe = last.author?.username !== me;
  if (!argv.includes("--all") && !waitingOnMe) continue;
  threads.push({ id: d.id, author: first.author?.username, bot: isBot(first.author), path: first.position?.new_path || null, line: first.position?.new_line || first.position?.old_line || null,
    body: clean(first.body).slice(0, 400), replies: notes.length - 1, waiting_on_me: waitingOnMe, resolvable, url: `${info.web_url}#note_${first.id}` });
}
const out = { mr: info.web_url, iid: Number(mr), state: info.state, draft: !!info.draft, approvals: approvals ? { approved: !!approvals.approved, left: approvals.approvals_left ?? null, by: (approvals.approved_by || []).map((x) => x.user?.username) } : null,
  pipeline: info.head_pipeline?.status || null, threads, humans: threads.filter((t) => !t.bot).length, bots: threads.filter((t) => t.bot).length };
if (argv.includes("--json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`!${mr} ${info.state}${info.draft ? " (draft)" : ""} · pipeline ${out.pipeline || "?"} · approvals: ${out.approvals ? (out.approvals.approved ? "approved" : `${out.approvals.left} left`) + (out.approvals.by.length ? ` (${out.approvals.by.join(", ")})` : "") : "?"}`);
if (!threads.length) console.log("no open threads waiting on you");
for (const t of threads) console.log(`- [${t.id}] ${t.bot ? "🤖 " : ""}${t.author}${t.path ? ` · ${t.path}${t.line ? ":" + t.line : ""}` : " · (general)"}${t.replies ? ` · ${t.replies} repl${t.replies > 1 ? "ies" : "y"}` : ""}\n    ${t.body}`);
