#!/usr/bin/env node
// Status line for Claude Code / aircode.
// Line 1: agent · model · effort · context · cost · duration
// Line 2: repo/folder · branch · worktree · lines · cache · OpenSpec changes
// Line 3: subagents / tools / skills used in this session, with approximate cost share
// Line 4+: one line per subagent running right now (model, context, tokens, last tool, elapsed)
//
// The status line only receives the main session's data, even while you view a subagent,
// so live subagent info is read from their transcripts. Set "refreshInterval": 3 in the
// statusLine settings so it keeps updating while the main agent waits.
//
// Report mode (full breakdown for a session):
//   node ~/.claude/statusline.mjs --report [transcript.jsonl]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// ── Colours: 256-colour palette tuned for dark terminal backgrounds ──
const fg = (n) => `\x1b[38;5;${n}m`;
const c = {
  dim: fg(250), sep: fg(244), bar: fg(240),
  red: fg(210), grn: fg(114), yel: fg(221), blu: fg(117), mag: fg(213), cyn: fg(87), org: fg(215),
  rst: "\x1b[0m",
};
const paint = (col, s) => `${c[col]}${s}${c.rst}`;
const SEP = paint("sep", " │ ");
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n ?? 0)));
const usd = (n) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : n > 0 ? `$${n.toFixed(4)}` : "$0");

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const SUBAGENT_LOG = path.join(CFG_DIR, "logs", "subagents.jsonl");
const CACHE_DIR = path.join(os.tmpdir(), "claude-statusline");
let SHIP = null; // /ship state segment on line 2, rendered once the session cost is known
let SESSION_REAL = null; // session cost from pricing.json (main + subagents), null if a model has no price

// ── Usage accounting ─────────────────────────────────────────────────
// Relative weights used to split the session cost between agents/tools.
// They mirror typical LLM pricing ratios (cache read cheap, output expensive);
// only the proportions matter, the absolute total comes from Claude Code.
const W = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
const weight = (u) => u.input * W.input + u.cacheWrite * W.cacheWrite + u.cacheRead * W.cacheRead + u.output * W.output;
// Real prices (USD per 1M tokens) from ~/.claude/pricing.json — same file cc-cost uses.
let PRICES = {};
try { PRICES = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "pricing.json"), "utf8")); delete PRICES._source; } catch {}
const normModel = (m = "") => m.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
// tool_use_id → agent actually launched (model-router.mjs rewrites subagent_type through a variant)
const ROUTER_LOG = path.join(CFG_DIR, "logs", "model-router.jsonl");
let ROUTED = null;
function routedAgent(toolUseId) {
  if (!toolUseId) return null;
  if (!ROUTED) { ROUTED = new Map(); try { for (const l of fs.readFileSync(ROUTER_LOG, "utf8").split("\n").slice(-400)) { try { const r = JSON.parse(l); if (r.tool_use_id) ROUTED.set(r.tool_use_id, r.variant || r.subagent_final || r.launched_as); } catch {} } } catch {} }
  return ROUTED.get(toolUseId) || null;
}
const baseAgent = (t) => (t ? String(t).replace(/--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)$/, "") : t);
const bareModel = (m = "") => normModel(m).split("/").pop();
const priceFor = (m) => PRICES[m] || PRICES[normModel(m)] || PRICES[bareModel(m)] || null;
const callUsd = (u, model) => {
  const p = priceFor(model); if (!p) return null;
  return ((u.input_tokens || 0) * p.input + (u.cache_creation_input_tokens || 0) * (p.cacheWrite ?? p.input) +
          (u.cache_read_input_tokens || 0) * (p.cacheRead ?? p.input * 0.1) + (u.output_tokens || 0) * p.output) / 1e6;
};
const emptyUsage = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, calls: 0, usd: 0, unpriced: 0 });
const addUsage = (a, u, model) => {
  a.input += u.input_tokens || 0; a.cacheWrite += u.cache_creation_input_tokens || 0; a.cacheRead += u.cache_read_input_tokens || 0; a.output += u.output_tokens || 0; a.calls++;
  const c = callUsd(u, model); if (c == null) { if (model && model !== "<synthetic>") a.unpriced++; } else a.usd += c;
};

// Incrementally parse a transcript JSONL, caching aggregates by byte offset.
function parseTranscript(file) {
  const st = { offset: 0, seen: [], usage: emptyUsage(), tools: {}, skills: {}, agentCalls: {}, pending: {} };
  if (!file || !fs.existsSync(file)) return st;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, "v2-" + Buffer.from(file).toString("base64url").slice(-120) + ".json");
  let s = st;
  try { s = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  const size = fs.statSync(file).size;
  if (size < s.offset) s = st; // file rotated/rewritten
  if (size === s.offset) return s;

  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - s.offset);
  fs.readSync(fd, buf, 0, buf.length, s.offset);
  fs.closeSync(fd);
  const text = buf.toString("utf8");
  const lastNl = text.lastIndexOf("\n");
  if (lastNl < 0) return s;
  const seen = new Set(s.seen);

  for (const line of text.slice(0, lastNl).split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const m = e.message;
    if (!m || typeof m !== "object") continue;

    // Usage: one entry per API response (dedupe streamed blocks by message id).
    if (e.type === "assistant" && m.usage && !seen.has(m.id)) { seen.add(m.id); addUsage(s.usage, m.usage, m.model); }

    const content = Array.isArray(m.content) ? m.content : [];
    for (const b of content) {
      if (b.type === "tool_use") {
        let name = b.name || "?";
        if (name === "Task" || name === "Agent") {
          // The transcript keeps the lead's original input (e.g. "task"); the router log says what was really launched.
          const a = baseAgent(routedAgent(b.id) || b.input?.subagent_type || "general-purpose");
          s.agentCalls[a] = (s.agentCalls[a] || 0) + 1;
          continue; // shown under "agents", not "tools"
        } else if (name === "Skill") {
          const sk = b.input?.skill || b.input?.name || "?";
          s.skills[sk] = s.skills[sk] || { n: 0, tok: 0 };
          s.skills[sk].n++;
          s.pending[b.id] = { kind: "skill", key: sk };
          continue;
        }
        name = name.replace(/^mcp__/, "mcp:").replace(/__/g, ":");
        s.tools[name] = s.tools[name] || { n: 0, tok: 0 };
        s.tools[name].n++;
        s.pending[b.id] = { kind: "tool", key: name };
      } else if (b.type === "tool_result" && s.pending[b.tool_use_id]) {
        // Context added by the tool result (≈ chars/4) — what later turns keep paying for.
        const p = s.pending[b.tool_use_id];
        const raw = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const bucket = p.kind === "skill" ? s.skills : s.tools;
        if (bucket[p.key]) bucket[p.key].tok += raw.length / 4;
        delete s.pending[b.tool_use_id];
      }
    }
    // Slash commands / skills typed by the user, e.g. /opsx:propose
    if (e.type === "user" && typeof m.content === "string") {
      const cmd = m.content.match(/<command-name>\/?([^<]+)<\/command-name>/);
      if (cmd) { const sk = "/" + cmd[1].trim(); s.skills[sk] = s.skills[sk] || { n: 0, tok: 0 }; s.skills[sk].n++; }
    }
  }
  s.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
  s.seen = [...seen].slice(-5000);
  try { fs.writeFileSync(cacheFile, JSON.stringify(s)); } catch {}
  return s;
}

// Subagent transcripts: from the SubagentStop hook log, plus the default sidechain folder.
function subagentRuns(sessionId, mainTranscript) {
  const runs = new Map(); // path -> type
  try {
    for (const l of fs.readFileSync(SUBAGENT_LOG, "utf8").split("\n")) {
      if (!l.includes(sessionId)) continue;
      try { const j = JSON.parse(l); if (j.agent_transcript_path) runs.set(j.agent_transcript_path, baseAgent(j.agent_type) || "?"); } catch {}
    }
  } catch {}
  if (mainTranscript) {
    const dir = path.join(path.dirname(mainTranscript), sessionId, "subagents");
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) {
        const p = path.join(dir, f);
        if (!runs.has(p)) {
          let type = "?";
          try { const meta = JSON.parse(fs.readFileSync(p.replace(/\.jsonl$/, ".meta.json"), "utf8")); type = meta.agentType || meta.agent_type || type; } catch {}
          if (type === "?") type = headJson(p).map((e) => e.agentType || e.agent_type || e.subagentType).find(Boolean) || "subagent";
          type = baseAgent(type);
          runs.set(p, type);
        }
      }
    } catch {}
  }
  return runs;
}

function collect(sessionId, transcript) {
  const main = parseTranscript(transcript);
  const agents = {}; // type -> { runs, usage }
  const tools = { ...main.tools }, skills = { ...main.skills };
  const merge = (dst, src) => { for (const [kk, v] of Object.entries(src)) { dst[kk] = dst[kk] || { n: 0, tok: 0 }; dst[kk] = { n: dst[kk].n + v.n, tok: dst[kk].tok + v.tok }; } };
  for (const [p, type] of subagentRuns(sessionId, transcript)) {
    const s = parseTranscript(p);
    const t = type.replace(/^aircall-aircode-agents:/, "aircode:");
    agents[t] = agents[t] || { runs: 0, usage: emptyUsage() };
    agents[t].runs++;
    for (const kk of ["input", "cacheWrite", "cacheRead", "output", "calls", "usd", "unpriced"]) agents[t].usage[kk] += s.usage[kk] || 0;
    merge(tools, s.tools); merge(skills, s.skills);
  }
  // Agents that were launched but have no transcript yet (still running).
  for (const [a, n] of Object.entries(main.agentCalls)) {
    const t = a.replace(/^aircall-aircode-agents:/, "aircode:");
    if (!agents[t]) agents[t] = { runs: n, usage: emptyUsage(), running: true };
  }
  const totalW = weight(main.usage) + Object.values(agents).reduce((acc, a) => acc + weight(a.usage), 0);
  const priced = main.usage.unpriced === 0 && Object.values(agents).every((a) => !a.usage.unpriced);
  const totalUsd = main.usage.usd + Object.values(agents).reduce((acc, a) => acc + a.usage.usd, 0);
  return { main, agents, tools, skills, totalW, priced, totalUsd };
}


// ── ETAs from history (medians) ───────────────────────────────────────
const median = (xs) => { if (xs.length < 3) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const fmtMin = (sec) => (sec == null ? "?" : sec < 90 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}m`);
let AGENT_DUR = null; // key "base|model" and "base" → median seconds
function agentMedian(base, model) {
  if (!AGENT_DUR) { AGENT_DUR = new Map(); const by = new Map();
    try { for (const r of tailJsonl(SUBAGENT_LOG, 512 * 1024)) { if (!r.duration_s || !r.base) continue; for (const key of [`${r.base}|${r.model || ""}`, r.base]) { if (!by.has(key)) by.set(key, []); by.get(key).push(r.duration_s); } } } catch {}
    for (const [key, xs] of by) AGENT_DUR.set(key, median(xs)); }
  return AGENT_DUR.get(`${base}|${model}`) ?? AGENT_DUR.get(base) ?? null;
}
const SHIP_STAGES = ["prepare", "understand", "gate-facts", "plan", "review-plan", "gate-human", "implement", "review-code", "stop-mr", "open-mr", "pipeline", "review-mr", "feedback", "close", "ready-for-merge"];
const HUMAN_STAGES = new Set(["gate-facts", "gate-human", "stop-mr", "ready-for-merge"]);
function stageMedians() { const by = new Map(); try { for (const r of tailJsonl(path.join(CFG_DIR, "logs", "ship-stages.jsonl"), 512 * 1024)) { if (r.seconds == null || HUMAN_STAGES.has(r.stage)) continue; if (!by.has(r.stage)) by.set(r.stage, []); by.get(r.stage).push(r.seconds); } } catch {} const m = new Map(); for (const [k, xs] of by) m.set(k, median(xs)); return m; }
// remaining agent time for a /ship state: rest of the current stage + medians of the stages still to run (human stops excluded)
function shipEta(s) {
  const med = stageMedians(); const i = SHIP_STAGES.indexOf(s.stage); if (i < 0) return null;
  const entered = [...(s.history || [])].reverse().find((h) => h.event && h.event.endsWith(`→ ${s.stage}`))?.ts || s.created;
  const elapsed = entered ? (Date.now() - new Date(entered).getTime()) / 1000 : 0;
  let total = 0, unknown = 0;
  for (const st of SHIP_STAGES.slice(i)) { if (HUMAN_STAGES.has(st)) continue; const m = med.get(st); if (m == null) { unknown++; continue; } total += st === s.stage ? Math.max(0, m - elapsed) : m; }
  if (total === 0 && unknown) return "?"; return `~${fmtMin(total)}${unknown ? "+?" : ""} left`;
}

// ── Live subagents ────────────────────────────────────────────────────
function tailJsonl(file, bytes = 256 * 1024) {
  const size = fs.statSync(file).size, start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, "r"), buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n"); if (start > 0) lines.shift();
  return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function headJson(file) {
  try { const fd = fs.openSync(file, "r"), buf = Buffer.alloc(16384); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    return buf.toString("utf8", 0, n).split("\n").slice(0, 5).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function liveSubagents(sessionId, mainTranscript) {
  const dir = path.join(path.dirname(mainTranscript), sessionId, "subagents");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f)); } catch { return []; }
  // id/path → time of its last SubagentStop. An agent continued with SendMessage writes to the same transcript after
  // that stop, so "stopped" means: stopped AND nothing written since (else it is running again).
  const stopped = new Map();
  const mark = (k, t) => { if (k && t > (stopped.get(k) || 0)) stopped.set(k, t); };
  try { for (const l of fs.readFileSync(SUBAGENT_LOG, "utf8").split("\n")) if (l.includes(sessionId)) { try { const j = JSON.parse(l); const t = j.ts ? new Date(j.ts).getTime() : Infinity; if (j.agent_id) mark(String(j.agent_id), t); mark(j.agent_transcript_path, t); } catch {} } } catch {}
  const now = Date.now(), res = [];
  for (const f of files) {
    const id = path.basename(f, ".jsonl").replace(/^agent-/, "");
    const st = fs.statSync(f);
    const stopAt = Math.max(stopped.get(id) || 0, stopped.get(f) || 0);
    if ((stopAt && st.mtimeMs <= stopAt + 3000) || now - st.mtimeMs > 10 * 60 * 1000) continue;
    const entries = tailJsonl(f);
    let type = null;
    try { const meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, ".meta.json"), "utf8")); type = meta.agentType || meta.agent_type || meta.subagent_type; } catch {}
    const first = headJson(f);
    type = baseAgent(type || first.map((e) => e.agentType || e.agent_type || e.subagentType).find(Boolean) || `subagent ${id.slice(0, 6)}`);
    let model = "?", ctx = 0, out = 0, calls = 0, lastTool = "", seen = new Set();
    for (const e of entries) {
      const m = e.message; if (!m || e.type !== "assistant") continue;
      if (m.model) model = m.model;
      if (m.usage && !seen.has(m.id)) { seen.add(m.id); calls++; const u = m.usage; ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); out += u.output_tokens || 0; }
      for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === "tool_use") lastTool = b.name + (b.input?.command ? " " + b.input.command : b.input?.file_path ? " " + path.basename(b.input.file_path) : b.input?.pattern ? " " + b.input.pattern : "");
    }
    const t0 = first.find((e) => e.timestamp)?.timestamp;
    const full = parseTranscript(f).usage;
    res.push({ usd: full.unpriced ? null : full.usd, type: type.replace(/^aircall-aircode-agents:/, "aircode:"), model, ctx, out, calls, lastTool, ms: stopAt && isFinite(stopAt) ? now - stopAt : t0 ? now - new Date(t0).getTime() : 0, resumed: !!stopAt, idle: now - st.mtimeMs });
  }
  return res;
}

// ── Report mode ──────────────────────────────────────────────────────
if (process.argv[2] === "--report") {
  let file = process.argv[3];
  if (!file) {
    const proj = path.join(CFG_DIR, "projects", process.cwd().replace(/[\\/.]/g, "-"));
    const files = fs.existsSync(proj) ? fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(proj, f)) : [];
    file = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  if (!file) { console.error("No transcript found for this folder. Pass one: --report <file.jsonl>"); process.exit(1); }
  const sid = path.basename(file, ".jsonl");
  const r = collect(sid, file);
  const pct = (w) => (r.totalW ? ((100 * w) / r.totalW).toFixed(1) + "%" : "-");
  console.log(`Session ${sid}\n`);
  console.log("AGENT                         RUNS  API CALLS   INPUT  CACHE-R  OUTPUT  SHARE");
  const row = (name, runs, u) => console.log(`${name.padEnd(30)}${String(runs).padStart(4)}${String(u.calls).padStart(11)}${k(u.input + u.cacheWrite).padStart(8)}${k(u.cacheRead).padStart(9)}${k(u.output).padStart(8)}${pct(weight(u)).padStart(7)}`);
  row("main", 1, r.main.usage);
  for (const [a, v] of Object.entries(r.agents).sort((x, y) => weight(y[1].usage) - weight(x[1].usage))) row(a + (v.running ? " (running)" : ""), v.runs, v.usage);
  const table = (title, obj) => {
    console.log(`\n${title.padEnd(40)} CALLS  CONTEXT ADDED`);
    for (const [n, v] of Object.entries(obj).sort((x, y) => y[1].tok - x[1].tok || y[1].n - x[1].n)) console.log(`${n.slice(0, 40).padEnd(40)}${String(v.n).padStart(6)}${k(v.tok).padStart(15)}`);
  };
  table("TOOL", r.tools);
  table("SKILL / COMMAND", r.skills);
  console.log("\nSHARE = share of the session's token cost (weighted: cache read 0.1x, output 5x). Multiply by /cost for $.");
  process.exit(0);
}

// ── Status line ──────────────────────────────────────────────────────
let d = {};
try { d = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const dir = d.workspace?.current_dir || d.cwd || process.cwd();
const short = (s, n = 28) => (s && s.length > n ? "…" + s.slice(-(n - 1)) : s);

// Line 1
const l1 = [];
if (d.agent?.name) l1.push(paint("mag", d.agent.name.replace(/^aircall-aircode-agents:/, "aircode:")));
const model = d.model?.id || d.model?.display_name || "?";
l1.push(paint("cyn", model) + (d.effort?.level ? paint("dim", ` (${d.effort.level})`) : "") + (d.fast_mode ? paint("yel", " ⚡") : ""));
const cw = d.context_window || {};
const pct = Math.round(cw.used_percentage ?? 0);
const pcol = pct >= 80 ? "red" : pct >= 50 ? "yel" : "grn";
const filled = Math.round(pct / 10);
l1.push(paint(pcol, "█".repeat(filled)) + paint("bar", "░".repeat(10 - filled)) + paint(pcol, ` ${pct}%`) + paint("dim", ` ${k(cw.total_input_tokens)}/${k(cw.context_window_size)}`));
const cost = d.cost?.total_cost_usd ?? 0;
// Record Claude Code's session cost so cc-cost can report real $ per session (only when it changes).
try {
  if (d.session_id && cost > 0) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const last = path.join(CACHE_DIR, `cost-${d.session_id}`);
    let prev = 0; try { prev = Number(fs.readFileSync(last, "utf8")); } catch {}
    if (Math.abs(cost - prev) >= 0.005) {
      fs.mkdirSync(path.join(CFG_DIR, "logs"), { recursive: true });
      fs.appendFileSync(path.join(CFG_DIR, "logs", "session-costs.jsonl"), JSON.stringify({ t: new Date().toISOString(), session_id: d.session_id, cost, model: d.model?.id, cwd: d.workspace?.current_dir }) + "\n");
      fs.writeFileSync(last, String(cost));
    }
  }
} catch {}
const costIdx = l1.length; l1.push(""); // filled after line 3 (real $ from pricing.json when available)
const mins = Math.floor((d.cost?.total_duration_ms ?? 0) / 60000);
l1.push(paint("dim", mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`));
const rl = d.rate_limits || {};
if (rl.spend_limit?.used_percentage != null) l1.push(paint("yel", `spend ${Math.round(rl.spend_limit.used_percentage)}%`));
if (rl.five_hour?.used_percentage != null) l1.push(paint("dim", `5h ${Math.round(rl.five_hour.used_percentage)}%`));

// Line 2
const l2 = [];
l2.push(paint("blu", d.workspace?.repo?.name || short(dir.replace(os.homedir(), "~"))));
let branch = d.worktree?.branch;
if (!branch) { try { branch = execSync("git branch --show-current", { cwd: dir, stdio: ["ignore", "pipe", "ignore"], timeout: 500 }).toString().trim(); } catch {} }
if (branch) {
  let dirty = "";
  try { dirty = execSync("git status --porcelain -uno", { cwd: dir, stdio: ["ignore", "pipe", "ignore"], timeout: 500 }).toString().trim() ? "*" : ""; } catch {}
  l2.push(paint("grn", `git:${branch}${dirty}`));
}
const wt = d.worktree?.name || d.workspace?.git_worktree;
if (wt) l2.push(paint("yel", `wt:${wt}`));
// /ship loop state in this worktree (.claude/ship/<T>/state.json): stage, attempt, cost
try {
  const shipDir = path.join(dir, ".claude", "ship"); const ts = fs.readdirSync(shipDir).filter((t) => fs.existsSync(path.join(shipDir, t, "state.json")));
  // only the state of this worktree: ticket in the branch name, or state.worktree == this dir (never on main/detached)
  const onMain = !branch || /^(main|master|HEAD)$/.test(branch);
  const pick = ts.find((t) => (branch || "").includes(t)) || (!onMain ? ts.find((t) => { try { return JSON.parse(fs.readFileSync(path.join(shipDir, t, "state.json"), "utf8")).worktree === dir; } catch { return false; } }) : null) || null;
  if (pick) { const s = JSON.parse(fs.readFileSync(path.join(shipDir, pick, "state.json"), "utf8")); const gate = { "review-plan": "review-plan", implement: "review-code", "review-code": "review-code", pipeline: "pipeline" }[s.stage];
    const n = gate ? (s.attempts?.[gate] || 0) + 1 : 0; SHIP = { s, n, idx: l2.length, file: path.join(shipDir, pick, "state.json") }; l2.push(""); }
} catch {}
// rendered after the session cost is known (below): live = max(saved ticket cost, this session's real cost)
const renderShip = () => { if (!SHIP) return; const { s, n, idx } = SHIP; const live = Math.max(Number(s.cost_usd || 0), SESSION_REAL ?? cost ?? 0);
  // write-through: the budget gate in ship-gates reads state.cost_usd before every launch; keep it current (≥ 1 cent steps)
  if (live > Number(s.cost_usd || 0) + 0.01 && SHIP.file) { try { const cur = JSON.parse(fs.readFileSync(SHIP.file, "utf8")); if (live > Number(cur.cost_usd || 0)) { cur.cost_usd = Math.round(live * 10000) / 10000; cur.cost_updated = new Date().toISOString(); fs.writeFileSync(SHIP.file, JSON.stringify(cur, null, 2) + "\n"); } } catch {} }
  const eta = s.stopped || HUMAN_STAGES.has(s.stage) ? null : shipEta(s);
  // progress track: one cell per /ship stage, filled up to the current one (human stops shown as ◆)
  const si = SHIP_STAGES.indexOf(s.stage), track = SHIP_STAGES.map((st, i) => (i < si ? "▰" : i === si ? (HUMAN_STAGES.has(st) || s.stopped ? "◆" : "▶") : HUMAN_STAGES.has(st) ? "◇" : "▱")).join("");
  const col = s.stopped ? "red" : live > Number(s.budget_usd || 0) ? "red" : "yel";
  l2[idx] = paint(col, `ship `) + paint("dim", track) + paint(col, ` ${s.stage}${n > 1 ? "#" + n : ""} ${si + 1}/${SHIP_STAGES.length}${s.stopped ? " STOP" : ""} $${live.toFixed(2)}/${s.budget_usd}`) + (eta ? paint("dim", ` ${eta}`) : ""); };
const add = d.cost?.total_lines_added ?? 0, del = d.cost?.total_lines_removed ?? 0;
if (add || del) l2.push(paint("grn", `+${add}`) + paint("red", ` -${del}`));
const pc = d.prompt_cache;
if (pc?.hit_ratio != null) l2.push(paint(pc.warm ? "dim" : "yel", `cache ${Math.round(pc.hit_ratio * 100)}%${pc.warm ? "" : " cold"}`));
// OpenSpec: the change of this ticket if there is one (spec:<slug>), else the count of open changes. The worktree may
// not carry openspec/ (untracked in some repos): fall back to the main worktree of the repo.
try {
  const roots = [d.workspace?.project_dir || dir];
  try { const first = execSync("git worktree list --porcelain", { cwd: dir, stdio: ["ignore", "pipe", "ignore"], timeout: 500 }).toString().split("\n")[0].replace(/^worktree /, ""); if (first && !roots.includes(first)) roots.push(first); } catch {}
  const ch = roots.map((r) => path.join(r, "openspec", "changes")).find((p) => fs.existsSync(p));
  if (ch) {
    const changes = fs.readdirSync(ch, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "archive").map((e) => e.name);
    const ticket = (branch || "").match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
    const mine = ticket ? changes.find((c) => c.toLowerCase().includes(ticket.toLowerCase())) : null;
    l2.push(mine ? paint("cyn", `spec:${mine}`) : paint("dim", `openspec ${changes.length}${ticket ? " (none for " + ticket + ")" : ""}`));
  }
} catch {}

// Line 3: agents · tools · skills
const l3 = [];
try {
  if (d.session_id && d.transcript_path) {
    const r = collect(d.session_id, d.transcript_path);
    const share = (u) => (r.priced ? u.usd : r.totalW && cost ? (cost * weight(u)) / r.totalW : 0);
    SESSION_REAL = r.priced ? r.totalUsd : null;
    const ag = Object.entries(r.agents).sort((x, y) => weight(y[1].usage) - weight(x[1].usage));
    if (ag.length) l3.push(paint("mag", "agents ") + ag.slice(0, 3).map(([n, v]) =>
      paint("mag", `${n}×${v.runs}`) + paint("dim", v.running && !v.usage.calls ? " …" : ` ${r.priced ? usd(share(v.usage)) : cost ? "~" + usd(share(v.usage)) : k(weight(v.usage))}`)).join(paint("sep", " · ")) + (ag.length > 3 ? paint("dim", ` +${ag.length - 3}`) : ""));
    const tl = Object.entries(r.tools).sort((x, y) => y[1].tok - x[1].tok || y[1].n - x[1].n);
    if (tl.length) l3.push(paint("org", "tools ") + tl.slice(0, 4).map(([n, v]) => paint("org", `${n}×${v.n}`) + paint("dim", ` ${k(v.tok)}`)).join(paint("sep", " · ")) + (tl.length > 4 ? paint("dim", ` +${tl.length - 4}`) : ""));
    const sk = Object.entries(r.skills).sort((x, y) => y[1].n - x[1].n);
    if (sk.length) l3.push(paint("cyn", "skills ") + sk.slice(0, 3).map(([n, v]) => paint("cyn", `${n}×${v.n}`)).join(paint("sep", " · ")) + (sk.length > 3 ? paint("dim", ` +${sk.length - 3}`) : ""));
  }
} catch {}

renderShip();
{
  const shown = SESSION_REAL ?? cost;
  const col = shown >= 10 ? "red" : shown >= 3 ? "yel" : "grn";
  l1[costIdx] = paint(col, usd(shown)) + (SESSION_REAL != null && cost ? paint("dim", ` (cc ${usd(cost)})`) : "");
}

// Line 4+: live subagents
const live = [];
try {
  if (d.session_id && d.transcript_path) for (const a of liveSubagents(d.session_id, d.transcript_path)) {
    const secs = Math.round(a.ms / 1000);
    live.push([paint("mag", "▶ " + a.type) + (a.resumed ? paint("dim", " (continued)") : ""), paint("cyn", a.model),
      paint(a.ctx > 150000 ? "red" : a.ctx > 80000 ? "yel" : "grn", `ctx ${k(a.ctx)}`) + paint("dim", ` · ${a.calls} calls · out ${k(a.out)}`) + (a.usd != null ? paint("grn", ` · ${usd(a.usd)}`) : ""),
      paint("dim", secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`) + (() => { const m = agentMedian(a.type, a.model); return m ? paint(secs > m * 1.5 ? "yel" : "dim", `/~${fmtMin(m)}`) : ""; })() + (a.idle > 60000 ? paint("yel", " (idle)") : ""),
      paint("org", short(a.lastTool.replace(/\s+/g, " "), 40))].filter(Boolean));
  }
} catch {}

process.stdout.write([l1, l2, l3, ...live].filter((l) => l.length).map((l) => l.join(SEP)).join("\n") + "\n");
