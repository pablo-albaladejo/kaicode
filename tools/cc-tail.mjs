#!/usr/bin/env node
// cc-tail: follow, in another terminal, what the subagents of the current session are doing — one line per tool call
// (Bash command, file read/written, grep pattern) and the text they produce — read live from their transcripts.
//   node ~/.claude/tools/cc-tail.mjs            # subagents of the latest session for this folder
//   node ~/.claude/tools/cc-tail.mjs --all      # also the main agent's own tool calls
//   node ~/.claude/tools/cc-tail.mjs --since 10 # replay the last 10 minutes first (default 2)
// Ctrl-C to stop. Read-only: it never touches the session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const argv = process.argv.slice(2), ALL = argv.includes("--all"), PANES = argv.includes("--panes");
const sinceMin = Number(argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : 2) || 2;
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null; // follow one transcript (used by --panes)
//   --panes   inside tmux: open one pane per live subagent (each running cc-tail --only <transcript>), close it when
//             the agent stops. Requires $TMUX. The OMC-style "one pane per agent" view.
import { execSync } from "node:child_process";
const proj = path.join(CFG_DIR, "projects", process.cwd().replace(/[\\/.]/g, "-"));
const tty = process.stdout.isTTY; const c = (n, s) => (tty ? `\x1b[38;5;${n}m${s}\x1b[0m` : s);
const colors = {}; let ci = 0; const palette = [213, 117, 114, 221, 215, 87, 210];
const col = (k) => (colors[k] ??= palette[ci++ % palette.length]);
const base = (t) => String(t || "?").replace(/--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)$/, "");

// The active session = the most recently written transcript in this folder's project dir. Re-evaluated on every tick,
// because a `claude` started a moment ago may not have written its transcript yet when cc-tail starts.
let session = null, sid = null, subDir = null;
function pickSession() {
  let files = []; try { files = fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(proj, f)); } catch { return; }
  const newest = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; if (!newest || newest === session) return;
  session = newest; sid = path.basename(session, ".jsonl"); subDir = path.join(proj, sid, "subagents"); offsets.clear();
  if (!ONLY) console.error(c(244, `session ${sid.slice(0, 8)} · ${subDir}`));
}
if (ONLY) console.error(c(244, `following ${path.basename(ONLY)}`));
// Swallow keystrokes (mouse-wheel arrow keys, focus events) so they are not echoed into the pane; q / Ctrl-C quit.
if (process.stdin.isTTY) { try { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", (k) => { if (k[0] === 3 || k[0] === 113) process.exit(0); }); } catch {} }

const offsets = new Map(), names = new Map(), pending = new Map(); // tool_use_id → {agent, name, t0}
const short = (s, n = 110) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const hhmmss = (t) => new Date(t || Date.now()).toTimeString().slice(0, 8);
function agentName(f) {
  if (names.has(f)) return names.get(f);
  let n = null; try { const m = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, ".meta.json"), "utf8")); n = m.agentType || m.agent_type; } catch {}
  if (!n) { try { for (const l of fs.readFileSync(f, "utf8").split("\n").slice(0, 5)) { try { const e = JSON.parse(l); n = e.agentType || e.agent_type || n; } catch {} } } catch {} }
  n = base(n) || "agent-" + path.basename(f, ".jsonl").slice(-6); names.set(f, n); return n;
}
function detail(b) {
  const i = b.input || {};
  if (b.name === "Bash") return i.command; if (b.name === "Read") return path.basename(i.file_path || "") + (i.offset ? `:${i.offset}` : ""); if (b.name === "Write" || b.name === "Edit" || b.name === "MultiEdit") return path.basename(i.file_path || "");
  if (b.name === "Grep") return `/${i.pattern}/ ${i.path ? path.basename(i.path) : ""}`; if (b.name === "Glob") return i.pattern; if (b.name === "Agent" || b.name === "Task") return `${i.subagent_type} · ${i.description || ""}`; if (b.name === "Skill") return i.skill;
  return short(JSON.stringify(i), 60);
}
function emit(f, e, replayCutoff) {
  const t = e.timestamp ? new Date(e.timestamp).getTime() : Date.now(); if (t < replayCutoff) return;
  const m = e.message; if (!m || typeof m !== "object") return; const who = agentName(f); const tag = c(col(who), `[${who}]`);
  if (e.type === "assistant") for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b.type === "tool_use") { pending.set(b.id, { who, name: b.name, t0: t }); console.log(`${c(244, hhmmss(t))} ${tag} ${c(215, b.name)} ${short(detail(b))}`); }
    else if (b.type === "text" && b.text.trim()) console.log(`${c(244, hhmmss(t))} ${tag} ${c(250, "· " + short(b.text, 140))}`);
  }
  if (e.type === "user") for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b.type === "tool_result" && pending.has(b.tool_use_id)) { const p = pending.get(b.tool_use_id); pending.delete(b.tool_use_id);
      const raw = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""); const err = b.is_error ? c(210, " ✗") : ""; const secs = Math.round((t - p.t0) / 1000);
      console.log(`${c(244, hhmmss(t))} ${tag} ${c(244, `  ↳ ${p.name} ${secs}s ${raw.length > 2000 ? Math.round(raw.length / 4) + " tok" : ""}`)}${err}${b.is_error ? " " + c(210, short(raw, 100)) : ""}`); }
  }
}
// ── --panes: one tmux pane per live subagent ───────────────────────────
const panes = new Map(); // transcript → pane id
const tmux = (a) => { try { return execSync(`tmux ${a}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } };
function stoppedSet() { const s = new Set(); try { for (const l of fs.readFileSync(path.join(CFG_DIR, "logs", "subagents.jsonl"), "utf8").split("\n").slice(-300)) { try { const j = JSON.parse(l); if (j.agent_transcript_path) s.add(j.agent_transcript_path); } catch {} } } catch {} return s; }
function managePanes(list) {
  if (!PANES) return; if (!process.env.TMUX) { console.error("--panes needs tmux"); process.exit(1); }
  const stopped = stoppedSet(), now = Date.now();
  for (const f of list) {
    if (f === session || panes.has(f)) continue;
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (stopped.has(f) || now - st.mtimeMs > 10 * 60000) continue;
    const id = tmux(`split-window -v -P -F '#{pane_id}' -t ${process.env.TMUX_PANE || ""} "node ${process.argv[1]} --only '${f}' --since 60; sleep 3"`);
    if (id) { panes.set(f, id); tmux(`select-layout -t ${id} even-vertical`); tmux(`select-pane -t ${id} -T '${agentName(f)}'`); }
  }
  for (const [f, id] of panes) { let idle = Infinity; try { idle = now - fs.statSync(f).mtimeMs; } catch {} if (stopped.has(f) || idle > 10 * 60000) { tmux(`kill-pane -t ${id}`); panes.delete(f); } }
}

function tick(first) {
  pickSession(); if (!session) { if (first) console.error(c(244, `waiting for a session in ${proj}`)); return; }
  const list = []; if (ALL) list.push(session); try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) list.push(path.join(subDir, f)); } catch {}
  if (ONLY) { list.length = 0; list.push(ONLY); }
  managePanes(list);
  const cutoff = first ? Date.now() - sinceMin * 60000 : 0;
  for (const f of list) {
    let size; try { size = fs.statSync(f).size; } catch { continue; }
    const from = offsets.get(f) ?? 0; if (size <= from) continue;
    const fd = fs.openSync(f, "r"), buf = Buffer.alloc(size - from); fs.readSync(fd, buf, 0, buf.length, from); fs.closeSync(fd);
    const text = buf.toString("utf8"); const lastNl = text.lastIndexOf("\n"); if (lastNl < 0) continue; offsets.set(f, from + Buffer.byteLength(text.slice(0, lastNl + 1)));
    for (const l of text.slice(0, lastNl).split("\n")) { if (!l) continue; try { emit(f, JSON.parse(l), cutoff); } catch {} }
  }
}
tick(true); setInterval(() => { tick(false); if (ONLY && stoppedSet().has(ONLY)) { console.log(c(244, "— agent finished —")); process.exit(0); } }, 1500);
