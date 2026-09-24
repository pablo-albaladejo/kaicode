#!/usr/bin/env node
// Posts a review to a GitLab MR as inline discussions only: one per finding, anchored to path:line in the
// Changes tab. No general notes. Uses `glab api` (project resolved from the current repo).
//
//   node ~/.claude/tools/mr-post.mjs --mr 123 [--dry-run] < review.json                  (inside the repo)
//   node ~/.claude/tools/mr-post.mjs --mr https://gitlab.com/group/project/-/merge_requests/123 < review.json   (from anywhere)
//   node ~/.claude/tools/mr-post.mjs --mr 123 --repo group/project < review.json
//
// stdin JSON (what the reviewer subagent returns):
// { "verdict": "REQUEST CHANGES", "pipeline": "passed", "summary": "…",
//   "findings": [ { "severity": "Major", "path": "src/a.ts", "line": 48, "message": "…",
//                   "fix": { "lang": "ts", "code": "…" } } ] }
// `line` is a line number in the NEW version of the file. GitLab only anchors comments to lines shown in the
// diff: a line outside it is moved to the nearest diff line of the same file (and the body says so); a file
// that is not in the diff cannot be commented and is reported back as not_posted.
// Re-running on the same MR does not repeat comments: each body carries a hidden marker
// <!-- cc-review:<hash of path+line+message> -->; findings whose marker already exists are skipped.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

const argv = process.argv.slice(2);
let mr = argv[argv.indexOf("--mr") + 1] || "";
let repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : null;
const dry = argv.includes("--dry-run");
const u = mr.match(/^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/); // MR URL → host, project path, iid
if (u) { repo = repo || u[2]; mr = u[3]; if (!process.env.GITLAB_HOST) process.env.GITLAB_HOST = u[1]; }
mr = mr.replace(/^!/, "");
if (!/^\d+$/.test(mr)) { console.error("usage: mr-post.mjs --mr <iid|!iid|MR URL> [--repo group/project] [--dry-run] < review.json"); process.exit(1); }
const project = repo ? encodeURIComponent(repo) : ":id"; // :id = project of the current repo (glab placeholder)
const review = JSON.parse(fs.readFileSync(0, "utf8"));
const api = (pathname, extra = []) => JSON.parse(execFileSync("glab", ["api", pathname, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
// POST with a real JSON body. `glab api -f "position[new_line]=…"` sends a JSON object with the literal key
// "position[new_line]", which GitLab ignores — the discussion is then created as a plain note instead of an
// inline one. Nested objects need a nested JSON body (--input -).
const apiJson = (pathname, payload) => JSON.parse(execFileSync("glab", ["api", pathname, "-X", "POST", "-H", "Content-Type: application/json", "--input", "-"], { encoding: "utf8", input: JSON.stringify(payload), stdio: ["pipe", "pipe", "pipe"] }));

// ── MR diff refs + diffs (all pages) ──────────────────────────────────
const mrInfo = api(`projects/${project}/merge_requests/${mr}`);
const refs = mrInfo.diff_refs; // { base_sha, head_sha, start_sha }
let diffs = [];
for (let page = 1; page < 50; page++) {
  const d = api(`projects/${project}/merge_requests/${mr}/diffs?per_page=100&page=${page}`);
  diffs = diffs.concat(d); if (d.length < 100) break;
}

// Map new-file line → { old_line|null, new_line } for every line that appears in the diff (added or context).
function lineMap(diffText) {
  const m = new Map(); let o = 0, n = 0;
  for (const l of diffText.split("\n")) {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = +h[1]; n = +h[2]; continue; }
    if (l.startsWith("+")) { m.set(n, { old_line: null, new_line: n }); n++; }
    else if (l.startsWith("-")) { o++; }
    else if (l.startsWith("\\")) { /* no newline marker */ }
    else { m.set(n, { old_line: o, new_line: n }); o++; n++; }
  }
  return m;
}
const byPath = new Map(diffs.map((d) => [d.new_path, { old_path: d.old_path, lines: lineMap(d.diff || "") }]));

// Markers of comments already on the MR (all discussion pages), to skip duplicates on re-runs.
const existing = new Set();
for (let page = 1; page < 50; page++) {
  const d = api(`projects/${project}/merge_requests/${mr}/discussions?per_page=100&page=${page}`);
  for (const disc of d) for (const n of disc.notes || []) for (const m of String(n.body || "").matchAll(/<!-- cc-review:([a-f0-9]{12}) -->/g)) existing.add(m[1]);
  if (d.length < 100) break;
}
const marker = (f) => createHash("sha1").update(`${f.path}:${f.line}:${f.message}`).digest("hex").slice(0, 12);

const fence = (f) => (f?.code ? `\n\nProposed fix:\n\`\`\`${f.lang || ""}\n${f.code.replace(/\n$/, "")}\n\`\`\`` : "");
const post = (endpoint, payload) => dry ? (console.error(JSON.stringify(payload)), { web_url: "(dry-run)" }) : apiJson(endpoint, payload);

const results = [], notPosted = [], skipped = [];
for (const f of review.findings || []) {
  const h = marker(f);
  if (existing.has(h)) { skipped.push({ path: f.path, line: f.line, severity: f.severity }); continue; }
  const file = byPath.get(f.path);
  if (!file || !file.lines.size) { notPosted.push({ path: f.path, line: f.line, severity: f.severity, reason: "file not in the MR diff" }); continue; }
  let line = Number(f.line), pos = file.lines.get(line), moved = "";
  if (!pos) { // nearest diff line of the same file
    const near = [...file.lines.keys()].sort((a, b) => Math.abs(a - line) - Math.abs(b - line))[0];
    pos = file.lines.get(near); moved = ` _(about line ${line})_`; line = near;
  }
  const body = `**[${f.severity}]**${moved} ${f.message}${fence(f.fix)}\n\n<!-- cc-review:${h} -->`;
  const position = { position_type: "text", base_sha: refs.base_sha, head_sha: refs.head_sha, start_sha: refs.start_sha, new_path: f.path, old_path: file.old_path || f.path, new_line: pos.new_line };
  if (pos.old_line != null) position.old_line = pos.old_line;
  try {
    const r = post(`projects/${project}/merge_requests/${mr}/discussions`, { body, position });
    const inline = dry || !!r?.notes?.[0]?.position; // GitLab answers with the position when it anchored the note
    if (!inline) { notPosted.push({ path: f.path, line: f.line, severity: f.severity, reason: "GitLab created it as a general note (no position in the answer)" }); }
    results.push({ path: f.path, line, severity: f.severity, inline, url: r?.notes?.[0]?.id ? `${mrInfo.web_url}#note_${r.notes[0].id}` : r.web_url || "posted" });
  } catch (e) { notPosted.push({ path: f.path, line: f.line, severity: f.severity, reason: String(e.stderr || e.message).slice(0, 160) }); }
}
console.log(JSON.stringify({ mr: mrInfo.web_url, posted: results, skipped_already_posted: skipped, not_posted: notPosted, dry_run: dry }, null, 1));
