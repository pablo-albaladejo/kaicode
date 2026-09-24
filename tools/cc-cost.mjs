#!/usr/bin/env node
// cc-cost — cost & token analysis for Claude Code / aircode sessions.
//
// Usage (run inside the repo you worked on):
//   cc-cost                       latest session of this folder, full report
//   cc-cost --session <id|file>   a specific session
//   cc-cost --days 7              all sessions of this folder in the last 7 days (per branch = per MR)
//   cc-cost --days 7 --all        same, across every project
//   cc-cost --top 15              longer "top" lists (default 10)
//   cc-cost --total 4.20          scale costs so the session total equals a known $ (e.g. from Langfuse)
//   cc-cost --json                machine-readable output
//   cc-cost --include ~/.claude.bak,~/.claude-work   also read sessions from other config dirs
//
// Prices: ~/.claude/pricing.json, USD per million tokens, e.g.
//   { "fireworks/deepseek-v4.1-flash": { "input": 0.5, "output": 2, "cacheRead": 0.05, "cacheWrite": 0.5 },
//     "default": { ... } }
// Without prices, costs are shown in "u" (weighted token units: input 1, cache write 1.25,
// cache read 0.1, output 5, per million tokens) — fine for comparing, not for absolute $.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── CLI ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i < 0 ? def : argv[i + 1] ?? true; };
const flag = (name) => argv.includes(name);
const TOP = Number(opt("--top", 10));
const JSON_OUT = flag("--json");
const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJECTS = path.join(CFG_DIR, "projects");
const expand = (p) => p.replace(/^~(?=\/|$)/, os.homedir());
const PROJECT_ROOTS = [PROJECTS, ...String(opt("--include", "") || "").split(",").filter(Boolean).map((d) => path.join(expand(d.trim()), "projects"))];
const SUBAGENT_LOG = path.join(CFG_DIR, "logs", "subagents.jsonl");
const SHUNT_LOG = path.join(CFG_DIR, "logs", "read-shunt.jsonl"), CODEWRITE_LOG = path.join(CFG_DIR, "logs", "code-write.jsonl");
const readLogRows = (f, kind) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return { kind, ...JSON.parse(l) }; } catch { return null; } }).filter(Boolean); } catch { return []; } };
// cheap-model helpers (bulk-read reads, code-write writes) show up as pseudo-agents in each session they served
const SHUNT_ROWS = [...readLogRows(SHUNT_LOG, "bulk-read").filter((r) => r.kind === "bulk-read" || r.kind === "map"), ...readLogRows(CODEWRITE_LOG, "code-write")];
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Pricing ───────────────────────────────────────────────────────────
let PRICES = {};
try { PRICES = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "pricing.json"), "utf8")); } catch {}
const UNIT = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
// Model ids may carry a date or context suffix (claude-haiku-4-5-20251001, claude-opus-4-8[1m]).
const normModel = (m = "") => m.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
// "implementer--high" (effort variant generated for the router) is reported as "implementer"
const baseAgent = (t) => (t ? String(t).replace(/--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)$/, "") : t);
const bareModel = (m = "") => normModel(m).split("/").pop();
const priceFor = (model) => PRICES[model] || PRICES[normModel(model)] || PRICES[bareModel(model)] || PRICES.default || null;
delete PRICES._source;
const HAS_PRICES = Object.keys(PRICES).length > 0;
function costOf(u, model) {
  const p = model === "__units__" ? UNIT : priceFor(model) || UNIT;
  return (u.input * p.input + u.cacheWrite * (p.cacheWrite ?? p.input) + u.cacheRead * (p.cacheRead ?? p.input * 0.1) + u.output * p.output) / 1e6;
}
let SCALE = 1;
let USD = HAS_PRICES; // whether the current report's costs are real dollars
const money = (x, usd = USD) => {
  x *= SCALE;
  if (!usd) return (x >= 0.1 ? x.toFixed(2) : x.toFixed(3)) + "u";
  return x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `$${x.toFixed(3)}` : x > 0 ? `$${x.toFixed(4)}` : "$0";
};
// Real session cost as computed by Claude Code (the "$" in the status line):
//  1) logged by the status line into logs/session-costs.jsonl on every refresh
//  2) the "cost-state" entry Claude Code writes into the transcript
const SESSION_COST_LOG = path.join(CFG_DIR, "logs", "session-costs.jsonl");
const LOGGED_COST = new Map();
for (const root of [CFG_DIR, ...String(opt("--include", "") || "").split(",").filter(Boolean).map((d) => d.trim().replace(/^~(?=\/|$)/, os.homedir()))]) {
  try { for (const l of fs.readFileSync(path.join(root, "logs", "session-costs.jsonl"), "utf8").split("\n")) { try { const j = JSON.parse(l); if (j.cost > (LOGGED_COST.get(j.session_id) || 0)) LOGGED_COST.set(j.session_id, j.cost); } catch {} } } catch {}
}

// ── Formatting ────────────────────────────────────────────────────────
const tty = process.stdout.isTTY && !JSON_OUT;
const fg = (n) => (s) => (tty ? `\x1b[38;5;${n}m${s}\x1b[0m` : String(s));
const C = { h: fg(117), dim: fg(245), warn: fg(221), bad: fg(210), ok: fg(114), acc: fg(213) };
const k = (n) => { n = Math.round(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n); };
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
const trunc = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const hhmm = (t) => (t ? new Date(t).toTimeString().slice(0, 5) : "--:--");
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`; };
const out = [];
const say = (s = "") => out.push(s);
function table(headers, rows, aligns) {
  const w = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).replace(/\x1b\[[0-9;]*m/g, "").length)));
  const cell = (v, i) => { const s = String(v), len = s.replace(/\x1b\[[0-9;]*m/g, "").length, pad = " ".repeat(w[i] - len); return (aligns?.[i] ?? (i ? "r" : "l")) === "r" ? pad + s : s + pad; };
  say(C.dim(headers.map(cell).join("  ")));
  for (const r of rows) say(r.map(cell).join("  "));
}
const section = (t) => { say(); say(C.h("━━ " + t + " " + "━".repeat(Math.max(0, 70 - t.length)))); };
const spark = (vals) => { const b = "▁▂▃▄▅▆▇█", mx = Math.max(...vals, 1); return vals.map((v) => b[Math.min(7, Math.floor((v / mx) * 7.99))]).join(""); };

// ── Transcript parsing ────────────────────────────────────────────────
const readJsonl = (f) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const tokOf = (content) => (typeof content === "string" ? content : JSON.stringify(content ?? "")).length / 4;

function detailOf(name, input = {}) {
  if (name === "Bash") return input.command || "";
  if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)) return input.file_path || input.notebook_path || "";
  if (name === "Grep") return `${input.pattern ?? ""} ${input.path ?? ""}`;
  if (name === "Glob") return input.pattern || "";
  if (name === "WebFetch") return input.url || "";
  if (name === "WebSearch") return input.query || "";
  return JSON.stringify(input).slice(0, 120);
}
const bashKey = (cmd) => {
  const words = cmd.replace(/^(cd [^&;]+(&&|;)\s*)+/, "").trim().split(/\s+/);
  const first = words[0] === "rtk" ? words.slice(0, 3) : words.slice(0, 2);
  return first.join(" ").replace(/["'].*$/, "");
};

// Parse one transcript (main or subagent) into API calls and tool events.
function parseAgent(file, agentName) {
  const entries = readJsonl(file);
  const calls = [];       // one per API response
  const tools = [];       // tool uses with result size
  const skills = [];      // Skill tool uses + slash commands
  const agentLaunches = [];
  const compactions = [];
  const byId = new Map(), pending = new Map();
  let lastUser = "", branch = null, lastPrompt = "", cwd = null, costState = null;
  for (const e of entries) {
    if (e.gitBranch) branch = e.gitBranch;
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.type === "system" && /compact/i.test(e.subtype || e.content || "")) compactions.push(e.timestamp);
    if (e.type === "cost-state" && e.totalCostUSD > 0) costState = e;
    const m = e.message;
    if (!m || typeof m !== "object") continue;
    if (e.type === "user") {
      if (typeof m.content === "string") {
        const cmd = m.content.match(/<command-name>\/?([^<]+)<\/command-name>/);
        if (cmd) skills.push({ name: "/" + cmd[1].trim(), t: e.timestamp, tok: 0 });
        else lastPrompt = m.content;
        lastUser = "prompt: " + trunc(m.content.replace(/<[^>]+>/g, ""), 60);
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === "tool_result" && pending.has(b.tool_use_id)) {
            const t = pending.get(b.tool_use_id);
            t.tok = tokOf(b.content); t.error = !!b.is_error;
            pending.delete(b.tool_use_id);
            lastUser = `${t.name} ${trunc(t.detail, 50)}`;
          } else if (b.type === "text") { lastPrompt = b.text; lastUser = "prompt: " + trunc(b.text, 60); }
        }
      }
    }
    if (e.type === "assistant") {
      if (m.usage) {
        const u = m.usage;
        const key = m.id || e.uuid;
        let c = byId.get(key);
        if (!c) {
          c = { id: key, t: e.timestamp, model: m.model || "?", agent: agentName, trigger: lastUser,
            input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, thinkingChars: 0, toolsCalled: [] };
          byId.set(key, c); calls.push(c);
        } else { c.output = Math.max(c.output, u.output_tokens || 0); }
      }
      const c = byId.get(m.id || e.uuid);
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === "thinking" && c) c.thinkingChars += (b.thinking || "").length;
        if (b.type !== "tool_use") continue;
        if (c) c.toolsCalled.push(b.name);
        if (b.name === "Task" || b.name === "Agent") { const type = baseAgent(b.input?.subagent_type || "general-purpose"); agentLaunches.push({ type, desc: b.input?.description || "", t: e.timestamp, callIdx: calls.length - 1 }); pending.set(b.id, { name: "Agent", detail: type }); continue; }
        if (b.name === "Skill") { const s = { name: b.input?.skill || b.input?.name || "?", t: e.timestamp, tok: 0 }; skills.push(s); pending.set(b.id, { set tok(v) { s.tok = v; }, set error(v) {}, name: "Skill", detail: s.name }); continue; }
        const t = { name: b.name.replace(/^mcp__/, "mcp:").replace(/__/g, ":"), detail: detailOf(b.name, b.input), t: e.timestamp, tok: 0, callIdx: calls.length - 1, agent: agentName };
        tools.push(t); pending.set(b.id, t);
      }
    }
  }
  // Context rent: a tool result stays in context and is re-read (cache read) on every later call
  // until the next compaction.
  const compactTimes = compactions.map((t) => new Date(t).getTime());
  for (const t of tools) {
    const tt = new Date(t.t).getTime();
    const nextCompact = compactTimes.find((x) => x > tt) ?? Infinity;
    t.laterCalls = calls.filter((c, i) => i > t.callIdx && new Date(c.t).getTime() < nextCompact).length;
    t.rentTok = t.tok * t.laterCalls;
  }
  for (const c of calls) { c.ctx = c.input + c.cacheWrite + c.cacheRead; c.cost = costOf(c, c.model); c.units = costOf(c, "__units__"); }
  return { file, agent: agentName, calls, tools, skills, agentLaunches, compactions, branch, cwd, costState, entries: entries.length };
}

function subagentFiles(sessionId, mainFile) {
  const types = new Map(); // agent_id -> type, path -> type
  for (const j of readJsonl(SUBAGENT_LOG)) {
    if (j.session_id !== sessionId) continue;
    if (j.agent_id) types.set(j.agent_id, baseAgent(j.agent_type));
    if (j.agent_transcript_path) types.set(j.agent_transcript_path, baseAgent(j.agent_type));
  }
  const files = new Set([...types.keys()].filter((x) => x.endsWith(".jsonl")));
  const dir = path.join(path.dirname(mainFile), sessionId, "subagents");
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) files.add(path.join(dir, f)); } catch {}
  return [...files].filter((f) => fs.existsSync(f)).map((f) => {
    const id = path.basename(f, ".jsonl").replace(/^agent-/, "");
    let type = types.get(f) || types.get(id);
    if (!type) { try { const meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, ".meta.json"), "utf8")); type = meta.agentType || meta.agent_type; } catch {} }
    type = baseAgent(type);
    return { file: f, type: (type || "subagent").replace(/^aircall-aircode-agents:/, "aircode:"), id };
  });
}

function analyzeSession(file) {
  const sessionId = path.basename(file, ".jsonl");
  const main = parseAgent(file, "main");
  const subs = subagentFiles(sessionId, file).map((s) => ({ ...parseAgent(s.file, s.type), id: s.id }));
  // bulk-read calls (tools/bulk-read.mjs, logged in logs/read-shunt.jsonl) made from this session's folder while it ran
  { const mt = main.calls.map((c) => new Date(c.t).getTime()).filter(Boolean);
    if (mt.length) { const t0 = Math.min(...mt) - 60000, t1 = Math.max(...mt) + 600000;
      for (const kind of ["bulk-read", "map", "code-write"]) {
        const rows = SHUNT_ROWS.filter((r) => r.kind === kind && !r.error && (!r.cwd || !main.cwd || r.cwd === main.cwd || r.cwd.startsWith(main.cwd)) && new Date(r.ts).getTime() >= t0 && new Date(r.ts).getTime() <= t1);
        if (rows.length) subs.push({ file: kind === "code-write" ? CODEWRITE_LOG : SHUNT_LOG, agent: kind, id: kind, tools: [], skills: [], agentLaunches: [], compactions: [], branch: null, cwd: main.cwd, costState: null, entries: rows.length,
          calls: rows.map((r, i) => ({ id: `${kind}-${i}`, t: r.ts, model: r.model, agent: kind, trigger: `${kind} ${trunc(r.question || r.out, 50)}`, input: r.input || 0, cacheWrite: 0, cacheRead: r.cache_read || 0, output: r.output || 0, thinkingChars: 0, toolsCalled: [] })) }); } } }
  for (const c of subs.flatMap((a) => (a.agent === "bulk-read" || a.agent === "map" || a.agent === "code-write" ? a.calls : []))) { c.ctx = c.input + c.cacheRead; c.cost = costOf(c, c.model); c.units = costOf(c, "__units__"); }
  const all = [main, ...subs];
  const calls = all.flatMap((a) => a.calls).sort((a, b) => new Date(a.t) - new Date(b.t));
  const tools = all.flatMap((a) => a.tools);
  const skills = all.flatMap((a) => a.skills);
  const sum = (arr, f) => arr.reduce((acc, x) => acc + (f(x) || 0), 0);
  // Calibrate to Claude Code's own dollar figure when we have no price table for these models.
  const realCalls = calls.filter((c) => c.model !== "<synthetic>" && c.model !== "?");
  let costSource = HAS_PRICES && realCalls.every((c) => priceFor(c.model)) ? "pricing.json" : "units";
  const realTotal = Math.max(LOGGED_COST.get(sessionId) || 0, main.costState?.totalCostUSD || 0);
  if (costSource === "units" && realTotal > 0) {
    const mu = main.costState?.modelUsage || {};
    const modelCost = Object.fromEntries(Object.entries(mu).map(([m, v]) => [m, v?.costUSD ?? v?.cost_usd ?? v?.cost ?? 0]).filter(([, v]) => v > 0));
    const unitsBy = {}; for (const c of calls) unitsBy[c.model] = (unitsBy[c.model] || 0) + c.cost;
    const covered = Object.keys(modelCost).length && Object.keys(unitsBy).every((m) => modelCost[m]);
    const allUnits = sum(calls, (c) => c.cost);
    for (const c of calls) c.cost = covered ? (c.cost * modelCost[c.model]) / unitsBy[c.model] : (c.cost * realTotal) / allUnits;
    costSource = "claude-code";
  }
  const tot = {
    calls: calls.length, input: sum(calls, (c) => c.input), cacheWrite: sum(calls, (c) => c.cacheWrite),
    cacheRead: sum(calls, (c) => c.cacheRead), output: sum(calls, (c) => c.output), cost: sum(calls, (c) => c.cost), units: sum(calls, (c) => c.units),
  };
  const times = calls.map((c) => new Date(c.t).getTime()).filter(Boolean);
  return { sessionId, file, main, subs, calls, tools, skills, tot, costSource, usd: costSource !== "units", start: Math.min(...times), end: Math.max(...times), branch: main.branch,
    project: main.cwd ? path.basename(main.cwd) : path.basename(path.dirname(file)),
    label: main.branch && main.branch !== "HEAD" ? main.branch : "(no branch)" };
}

// Cache breaks: a call where most of the previous context had to be re-written instead of read.
function cacheBreaks(agent) {
  const res = [];
  for (let i = 1; i < agent.calls.length; i++) {
    const prev = agent.calls[i - 1], c = agent.calls[i];
    // Break = most of the previous context was NOT read from cache and had to be written again.
    if (prev.ctx > 5000 && c.cacheRead < 0.5 * prev.ctx) {
      const gap = new Date(c.t) - new Date(prev.t);
      const compacted = agent.compactions.some((t) => new Date(t) > new Date(prev.t) && new Date(t) <= new Date(c.t));
      res.push({ call: c, gap, cause: compacted ? "compaction" : gap > CACHE_TTL_MS ? `idle ${dur(gap)} (cache expired)` : "prompt/tools changed" });
    }
  }
  return res;
}

// ── Single-session report ─────────────────────────────────────────────
function reportSession(r) {
  const { tot } = r;
  const knownTotal = Number(opt("--total", 0));
  USD = r.usd || !!knownTotal;
  if (knownTotal && tot.cost) SCALE = knownTotal / tot.cost;
  const inTok = tot.input + tot.cacheWrite + tot.cacheRead;
  const models = [...new Set(r.calls.map((c) => c.model))];

  section(`SESSION ${r.sessionId}`);
  say(`branch ${C.acc(r.branch || "-")}   ${new Date(r.start).toLocaleString()} → ${hhmm(r.end)}  (${dur(r.end - r.start)})   models: ${models.join(", ")}`);
  say(`API calls ${tot.calls}   input ${k(inTok)} (uncached ${k(tot.input)} · cache write ${k(tot.cacheWrite)} · cache read ${k(tot.cacheRead)})   output ${k(tot.output)}`);
  say(`cache hit ${C[tot.cacheRead / inTok > 0.8 ? "ok" : "warn"](pct(tot.cacheRead, inTok))}   compactions ${r.main.compactions.length}   subagent runs ${r.subs.length}   ` +
      `TOTAL ${C.acc(money(tot.cost))}` + (knownTotal ? C.dim("  (scaled to --total)") : r.costSource === "claude-code" ? C.dim("  ($ as computed by Claude Code, split per call by tokens)") : r.costSource === "pricing.json" ? C.dim("  (pricing.json)") : C.dim("  (units: no $ recorded for this session — see cc-cost --help)")));
  const costBy = { "uncached input": 0, "cache write": 0, "cache read": 0, output: 0 };
  for (const c of r.calls) {
    const p = priceFor(c.model) || UNIT;
    costBy["uncached input"] += (c.input * p.input) / 1e6; costBy["cache write"] += (c.cacheWrite * (p.cacheWrite ?? p.input)) / 1e6;
    costBy["cache read"] += (c.cacheRead * (p.cacheRead ?? p.input * 0.1)) / 1e6; costBy.output += (c.output * p.output) / 1e6;
  }
  const baseline = r.main.calls.length ? Math.min(...r.main.calls.slice(0, 3).map((c) => c.ctx)) : 0;
  const baseShare = inTok ? (baseline * r.main.calls.length) / inTok : 0;
  say(`fixed overhead ${C.acc(k(baseline))} tokens/call (system prompt + tools + CLAUDE.md + skills/agents list) = ${C[baseShare > 0.4 ? "warn" : "ok"](pct(baseShare, 1))} of all input` +
      (tot.cacheWrite === 0 && tot.input > 0 ? C.dim("   (gateway reports no cache writes: they are counted as uncached input)") : ""));
  const CAL = r.costSource === "claude-code" && tot.units ? tot.cost / tot.units : 1; // units → $ when calibrated
  for (const kk of Object.keys(costBy)) costBy[kk] *= CAL;
  say("cost split: " + Object.entries(costBy).map(([n, v]) => `${n} ${money(v)} (${pct(v, tot.cost)})`).join(" · "));

  section("BY AGENT");
  const agents = [r.main, ...r.subs];
  const agg = new Map();
  for (const a of agents) {
    const g = agg.get(a.agent) || { runs: 0, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, tools: 0, peak: 0, ms: 0 };
    g.runs++; g.calls += a.calls.length; g.tools += a.tools.length;
    for (const c of a.calls) { g.input += c.input; g.cacheWrite += c.cacheWrite; g.cacheRead += c.cacheRead; g.output += c.output; g.cost += c.cost; g.peak = Math.max(g.peak, c.ctx); }
    if (a.calls.length) g.ms += new Date(a.calls.at(-1).t) - new Date(a.calls[0].t);
    agg.set(a.agent, g);
  }
  table(["agent", "runs", "calls", "tools", "uncached", "c.write", "c.read", "output", "peak ctx", "time", "cost", "share"],
    [...agg].sort((a, b) => b[1].cost - a[1].cost).map(([n, g]) => [n, g.runs, g.calls, g.tools, k(g.input), k(g.cacheWrite), k(g.cacheRead), k(g.output), k(g.peak), dur(g.ms), money(g.cost), pct(g.cost, tot.cost)]));
  if (r.main.agentLaunches.length) {
    say(C.dim("launches: ") + r.main.agentLaunches.map((l) => `${l.type}${l.desc ? ` "${trunc(l.desc, 30)}"` : ""}`).join(C.dim(" · ")));
  }

  section("CONTEXT GROWTH (main)");
  const ctxs = r.main.calls.map((c) => c.ctx);
  if (ctxs.length) {
    say(`${spark(ctxs.length > 70 ? ctxs.filter((_, i) => i % Math.ceil(ctxs.length / 70) === 0) : ctxs)}  start ${k(ctxs[0])} → peak ${k(Math.max(...ctxs))} → end ${k(ctxs.at(-1))}`);
    say(C.dim(`every main call re-sends the whole context: avg ${k(ctxs.reduce((a, b) => a + b, 0) / ctxs.length)} tokens/call`));
  }

  section(`TOP ${TOP} MOST EXPENSIVE API CALLS`);
  table(["time", "agent", "ctx", "c.write", "output", "cost", "triggered by", "then called"],
    [...r.calls].sort((a, b) => b.cost - a.cost).slice(0, TOP).map((c) => [hhmm(c.t), trunc(c.agent, 14), k(c.ctx), k(c.cacheWrite), k(c.output), money(c.cost), trunc(c.trigger, 42), trunc([...new Set(c.toolsCalled)].join(","), 20)]),
    ["l", "l", "r", "r", "r", "r", "l", "l"]);

  const breaks = [r.main, ...r.subs].flatMap(cacheBreaks);
  if (breaks.length) {
    section("CACHE BREAKS (context re-written instead of read)");
    table(["time", "agent", "re-written", "cost", "likely cause"],
      breaks.map((b) => [hhmm(b.call.t), trunc(b.call.agent, 14), k(b.call.cacheWrite + b.call.input), money(b.call.cost), b.cause]), ["l", "l", "r", "r", "l"]);
  }

  section("TOOLS");
  const toolAgg = new Map();
  for (const t of r.tools) {
    const g = toolAgg.get(t.name) || { n: 0, tok: 0, max: 0, rent: 0, err: 0 };
    g.n++; g.tok += t.tok; g.max = Math.max(g.max, t.tok); g.rent += t.rentTok; g.err += t.error ? 1 : 0;
    toolAgg.set(t.name, g);
  }
  const CAL2 = r.costSource === "claude-code" && tot.units ? tot.cost / tot.units : 1;
  const rentCost = (tok) => money(((tok * (priceFor(models[0])?.cacheRead ?? UNIT.cacheRead)) / 1e6) * CAL2);
  table(["tool", "calls", "errors", "result tok", "avg", "max", "context rent", "rent cost"],
    [...toolAgg].sort((a, b) => b[1].rent - a[1].rent).map(([n, g]) => [n, g.n, g.err || "", k(g.tok), k(g.tok / g.n), k(g.max), k(g.rent), rentCost(g.rent)]));
  say(C.dim("context rent = result tokens × later API calls that re-read them (until compaction)."));

  const bash = r.tools.filter((t) => t.name === "Bash");
  if (bash.length) {
    section("BASH BY COMMAND");
    const g = new Map();
    for (const t of bash) { const key = bashKey(t.detail); const x = g.get(key) || { n: 0, tok: 0, rent: 0, rtk: 0 }; x.n++; x.tok += t.tok; x.rent += t.rentTok; x.rtk += /^\s*rtk\b/.test(t.detail) ? 1 : 0; g.set(key, x); }
    table(["command", "calls", "via rtk", "result tok", "context rent"],
      [...g].sort((a, b) => b[1].rent - a[1].rent).slice(0, TOP).map(([n, x]) => [trunc(n, 40), x.n, x.rtk ? `${x.rtk}/${x.n}` : "", k(x.tok), k(x.rent)]));
  }

  const reads = r.tools.filter((t) => t.name === "Read" || (t.name === "Bash" && /^\s*(rtk\s+)?(cat|head|tail|less|sed -n|bat)\b/.test(t.detail)));
  if (reads.length) {
    section("FILES READ");
    const g = new Map();
    for (const t of reads) {
      const f = t.name === "Read" ? t.detail : (t.detail.match(/[\w./~-]+\.\w+/g) || ["?"]).pop();
      const x = g.get(f) || { n: 0, tok: 0, agents: new Set() }; x.n++; x.tok += t.tok; x.agents.add(t.agent); g.set(f, x);
    }
    table(["file", "reads", "tokens", "by"],
      [...g].sort((a, b) => b[1].tok - a[1].tok).slice(0, TOP).map(([f, x]) => [trunc(f.replace(os.homedir(), "~"), 60), x.n > 1 ? C.warn(x.n) : x.n, k(x.tok), [...x.agents].join(",")]));
  }

  section(`TOP ${TOP} TOOL RESULTS BY CONTEXT RENT`);
  table(["tool", "agent", "tokens", "rent", "detail"],
    [...r.tools].sort((a, b) => b.rentTok - a.rentTok).slice(0, TOP).map((t) => [t.name, trunc(t.agent, 14), k(t.tok), k(t.rentTok), trunc(t.detail.replace(os.homedir(), "~"), 70)]),
    ["l", "l", "r", "r", "l"]);

  if (r.skills.length) {
    section("SKILLS & COMMANDS");
    const g = new Map();
    for (const s of r.skills) { const x = g.get(s.name) || { n: 0, tok: 0 }; x.n++; x.tok += s.tok; g.set(s.name, x); }
    table(["skill / command", "uses", "tokens loaded"], [...g].sort((a, b) => b[1].n - a[1].n).map(([n, x]) => [n, x.n, k(x.tok)]));
  }

  const baseline2 = r.main.calls.length ? Math.min(...r.main.calls.slice(0, 3).map((c) => c.ctx)) : 0;
  const thinking = r.calls.reduce((a, c) => a + c.thinkingChars / 4, 0);
  section("FINDINGS");
  const f = [];
  const hit = tot.cacheRead / inTok;
  if (hit < 0.8) f.push(["warn", `Cache hit ${pct(tot.cacheRead, inTok)} (<80%). Each break re-writes the whole context; see CACHE BREAKS.`]);
  const idle = breaks.filter((b) => b.cause.startsWith("idle"));
  if (idle.length) f.push(["warn", `${idle.length} cache expiries after idle gaps (> ${CACHE_TTL_MS / 60000}m) cost ${money(idle.reduce((a, b) => a + b.call.cost, 0))}. Finish or /compact before long breaks.`]);
  const peak = Math.max(...r.main.calls.map((c) => c.ctx), 0);
  if (peak > 120000) f.push(["warn", `Main context peaked at ${k(peak)}. Split the work or /compact earlier: every call pays for the full context.`]);
  const mainReads = reads.filter((t) => t.agent === "main").length;
  if (mainReads > 2 && !r.subs.some((s) => /explore/i.test(s.agent))) f.push(["warn", `Main agent read ${mainReads} files itself and never used Explore. Delegating reads keeps them out of the main context.`]);
  const dup = reads.reduce((m, t) => m.set(t.detail, (m.get(t.detail) || 0) + 1), new Map());
  const dups = [...dup].filter(([, n]) => n > 1);
  if (dups.length) f.push(["warn", `${dups.length} files read more than once (e.g. ${trunc(dups[0][0].replace(os.homedir(), "~"), 50)} ×${dups[0][1]}).`]);
  const bigRes = r.tools.filter((t) => t.tok > 8000);
  if (bigRes.length) f.push(["warn", `${bigRes.length} tool results over 8k tokens (largest: ${bigRes.sort((a, b) => b.tok - a.tok)[0].name} ${k(bigRes[0].tok)}). Filter output (head, jq, rtk) or use line ranges.`]);
  const nonRtk = bash.filter((t) => !/^\s*rtk\b/.test(t.detail) && /^\s*(git|npm|pnpm|yarn|npx|vitest|jest|eslint|tsc|ls|find|grep|rg|cat)\b/.test(t.detail));
  if (nonRtk.length > 3) f.push(["warn", `${nonRtk.length} Bash commands RTK could compress ran without it. Check the RTK hook is active (rtk gain).`]);
  if (tot.output && thinking / tot.output > 0.5) f.push(["info", `~${pct(thinking, tot.output)} of output tokens were thinking. Lower effort (e.g. medium) for routine work.`]);
  const subCost = r.subs.reduce((a, s) => a + s.calls.reduce((x, c) => x + c.cost, 0), 0);
  if (r.subs.length && subCost > 0.6 * tot.cost) f.push(["info", `Subagents are ${pct(subCost, tot.cost)} of the cost. Check their maxTurns and what they return.`]);
  const errs = r.tools.filter((t) => t.error).length;
  if (errs > 3) f.push(["warn", `${errs} tool calls failed — retries cost full context each time.`]);
  if (baseline2 && (baseline2 * r.main.calls.length) / inTok > 0.4)
    f.push(["warn", `${pct(baseline2 * r.main.calls.length, inTok)} of input is the fixed overhead (${k(baseline2)} tokens re-sent on every call). Run /context in a fresh session to see what fills it (skills list, MCP tools, CLAUDE.md, agents) and trim it.`]);
  if (r.main.calls.length > 15 && r.subs.length === 0 && peak < 60000)
    f.push(["info", `${r.main.calls.length} small steps in one agent: fewer, batched commands (one script instead of many) cut calls, and each call re-pays the overhead.`]);
  if (!f.length) f.push(["ok", "Nothing obviously wasteful in this session."]);
  for (const [lvl, msg] of f) say(`${lvl === "ok" ? C.ok("✓") : lvl === "info" ? C.h("•") : C.warn("!")} ${msg}`);
}

// ── Multi-session report (--days) ─────────────────────────────────────
function listSessions(allProjects, sinceMs) {
  const here = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
  const dirs = PROJECT_ROOTS.flatMap((root) => {
    if (!fs.existsSync(root)) return [];
    // A repo's sessions also live under its worktrees' folders (<repo>-worktrees-…, <repo>--claude-worktrees-…).
    return fs.readdirSync(root).filter((d) => allProjects || d === here || d.startsWith(here + "-")).map((d) => path.join(root, d));
  });
  const files = [];
  for (const d of dirs) {
    try { for (const f of fs.readdirSync(d)) if (f.endsWith(".jsonl")) { const p = path.join(d, f); if (fs.statSync(p).mtimeMs >= sinceMs) files.push(p); } } catch {}
  }
  return files;
}

function reportRange(days, allProjects) {
  const files = listSessions(allProjects, Date.now() - days * 86400000);
  if (!files.length) { say("No sessions found."); return; }
  const all = files.map(analyzeSession);
  const rs = all.filter((r) => r.calls.length && (r.tot.input + r.tot.cacheRead + r.tot.output) > 0);
  const empty = all.length - rs.length;
  const both = (usd, u) => [usd ? money(usd, true) : "", u ? money(u, false) : ""].filter(Boolean).join(" + ") || "0";
  const add = (g, r) => { if (r.usd) g.usd += r.tot.cost; else g.u += r.tot.cost; g.units += r.tot.units; };
  const T = { usd: 0, u: 0, units: 0 }; rs.forEach((r) => add(T, r));
  section(`LAST ${days} DAYS — ${rs.length} sessions — total ${both(T.usd, T.u)}`);
  say(C.dim("$ = pricing.json or the cost Claude Code recorded · u = weighted token units (model without a price) · share = by token units"));
  const byBranch = new Map();
  for (const r of rs) {
    const key = (allProjects ? r.project + " · " : "") + r.label;
    const g = byBranch.get(key) || { n: 0, usd: 0, u: 0, units: 0, calls: 0, subs: 0, inTok: 0, cr: 0 };
    g.n++; add(g, r); g.calls += r.tot.calls; g.subs += r.subs.length;
    g.inTok += r.tot.input + r.tot.cacheWrite + r.tot.cacheRead; g.cr += r.tot.cacheRead;
    byBranch.set(key, g);
  }
  say(); say(C.dim("BY BRANCH (≈ cost per MR)"));
  table(["branch", "sessions", "API calls", "subagents", "cache hit", "cost", "share"],
    [...byBranch].sort((a, b) => b[1].units - a[1].units).map(([n, g]) => [trunc(n, 50), g.n, g.calls, g.subs, pct(g.cr, g.inTok), both(g.usd, g.u), pct(g.units, T.units)]));
  say(); say(C.dim("BY DAY"));
  const byDay = new Map();
  for (const r of rs) { const d = new Date(r.start).toISOString().slice(0, 10); const g = byDay.get(d) || { usd: 0, u: 0, units: 0 }; add(g, r); byDay.set(d, g); }
  const maxU = Math.max(...[...byDay.values()].map((g) => g.units));
  table(["day", "cost", ""], [...byDay].sort().map(([d, g]) => [d, both(g.usd, g.u), "█".repeat(Math.max(1, Math.round((30 * g.units) / maxU)))]), ["l", "r", "l"]);
  say(); say(C.dim("SESSIONS"));
  const shortModel = (m) => m.replace(/^fireworks\//, "").replace(/^claude-/, "").replace(/-\d{8}$/, "");
  table(["start", "project", "branch", "models", "time", "calls", "subagents", "peak ctx", "cache hit", "cost", "session"],
    rs.sort((a, b) => b.start - a.start).map((r) => {
      const inTok = r.tot.input + r.tot.cacheWrite + r.tot.cacheRead;
      return [new Date(r.start).toISOString().slice(5, 16).replace("T", " "), trunc(r.project, 18), trunc(r.label, 32), trunc([...new Set(r.calls.map((c) => shortModel(c.model)))].filter((m) => m !== "?" && m !== "<synthetic>").join(","), 24), dur(r.end - r.start), r.tot.calls, r.subs.length, k(Math.max(0, ...r.main.calls.map((c) => c.ctx))), pct(r.tot.cacheRead, inTok), money(r.tot.cost, r.usd), r.sessionId.slice(0, 8)];
    }));
  if (empty) say(C.dim(`\n${empty} sessions with no token usage hidden (aborted, failed or empty).`));
  say(C.dim("\nDrill into one: cc-cost --session <id>"));
}

// ── Main ──────────────────────────────────────────────────────────────
function latestSessionFile() {
  const files = listSessions(false, 0);
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
function resolveSession(s) {
  if (fs.existsSync(s)) return s;
  const files = listSessions(true, 0);
  return files.find((f) => path.basename(f).startsWith(s));
}

if (opt("--ticket")) {
  // Spend attributed to one ticket = every session that ran in its worktree or on its branch (one ticket = one worktree).
  const T = String(opt("--ticket")); const days = Number(opt("--days") || 30);
  const rs = listSessions(true, Date.now() - days * 86400000).map(analyzeSession).filter((r) => r.calls.length)
    .filter((r) => (r.branch || "").includes(T) || r.project === T || (r.main.cwd || "").split(path.sep).includes(T) || r.subs.some((a) => (a.agentLaunches || []).some((l) => l.desc.includes(T))) || r.main.agentLaunches.some((l) => l.desc.includes(T)));
  const cost = rs.reduce((a, r) => a + r.tot.cost, 0), calls = rs.reduce((a, r) => a + r.tot.calls, 0);
  if (JSON_OUT) console.log(JSON.stringify({ ticket: T, days, sessions: rs.length, calls, cost, usd: rs.every((r) => r.usd), by_session: rs.map((r) => ({ session: r.sessionId, branch: r.branch, start: new Date(r.start).toISOString(), cost: r.tot.cost })) }, null, 2));
  else console.log(`${T}: ${money(cost, rs.every((r) => r.usd))} over ${rs.length} session(s), ${calls} calls, last ${days} days`);
} else if (opt("--days")) {
  const days = Number(opt("--days"));
  if (JSON_OUT) {
    const rs = listSessions(flag("--all"), Date.now() - days * 86400000).map(analyzeSession).filter((r) => r.calls.length);
    console.log(JSON.stringify(rs.map((r) => ({ session: r.sessionId, branch: r.branch, start: new Date(r.start).toISOString(), ...r.tot, subagents: r.subs.length })), null, 2));
  } else { reportRange(days, flag("--all")); console.log(out.join("\n")); }
} else {
  const file = opt("--session") ? resolveSession(opt("--session")) : latestSessionFile();
  if (!file) { console.error("No session found for this folder. Run inside the repo, or use --session <id|file> / --days N --all."); process.exit(1); }
  const r = analyzeSession(file);
  if (JSON_OUT) {
    console.log(JSON.stringify({ session: r.sessionId, branch: r.branch, totals: r.tot,
      agents: [r.main, ...r.subs].map((a) => ({ agent: a.agent, calls: a.calls.length, cost: a.calls.reduce((x, c) => x + c.cost, 0) })),
      tools: r.tools.map(({ name, detail, tok, rentTok, agent, t }) => ({ name, detail, tok, rentTok, agent, t })),
      calls: r.calls.map(({ t, agent, model, input, cacheWrite, cacheRead, output, cost, trigger }) => ({ t, agent, model, input, cacheWrite, cacheRead, output, cost, trigger })) }, null, 2));
  } else { reportSession(r); console.log(out.join("\n")); }
}
