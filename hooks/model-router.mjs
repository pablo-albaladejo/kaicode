#!/usr/bin/env node
// PreToolUse hook (matcher: Agent|Task) — picks the model (and recommends the effort) for each subagent launch.
//
// Decision unit: (use case, complexity) → { model, effort } from the table in router.json ("useCases").
//   use case   one of 15 SDLC cases (explore, explain, status, plan, architecture, implement, bugfix, refactor,
//              tests, review, security, debug, migration, docs, cicd)
//   complexity low | medium | high
//
// Modes (router.json "mode", read on every launch):
//   "off"      do nothing
//   "shadow"   decide and log what it WOULD use; never changes the launch   (default)
//   "enforce"  rewrite tool_input.model when the decision differs from the agent's default
// Model + effort per launch: the Agent tool accepts neither an effort parameter nor a gateway model id in
//   updatedInput (only sonnet|opus|haiku|fable), so both live in generated agent variants
//   "<role>--<model alias>-<effort>" (tools/gen-effort-variants.mjs: same prompt, only model/effort differ) and the
//   hook swaps subagent_type to the right one. "effortMode": "log" only records the decision.
//
// Placeholder: the lead launches "task" (router.json "placeholder") and the router always assigns the role.
// Role: Jev's use_case implies a role (router.json "roles"); "roleMode": "log" records when the lead picked
//   another of our roles, "enforce" rewrites subagent_type to the implied role before choosing the effort variant.
// Classifier (router.json "classifier"): "rules" | "jev" | "both" (both = ask Jev, apply rules; default "both")
// Jev: two choice questions (use_case, complexity) in one call. "jevHighThreshold" = min P(high) to accept high.
//
// Log:      <config dir>/logs/model-router.jsonl
// Report:   node ~/.claude/hooks/model-router.mjs --report [days]
// Table:    node ~/.claude/hooks/model-router.mjs --criteria
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const CFG_DIR = process.env.CLAUDE_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(CFG_DIR, "logs", "model-router.jsonl");
const LEVELS = ["low", "medium", "high"];

// ── Defaults (override any key in router.json) ─────────────────────────
const DEFAULT_CONFIG = {
  mode: "shadow",
  classifier: "both",
  effortMode: "variant",
  // Role check: Jev's use_case implies a role. "log" records disagreements with the lead's choice; "enforce" rewrites
  // subagent_type to the implied role (only between the roles listed here, only when Jev is confident).
  roleMode: "enforce",
  // Generic entry point: the lead launches "task" with a brief and the router assigns the role from the use case.
  placeholder: "task",
  builtinAgents: ["general-purpose", "Plan", "claude", "claude-code-guide", "statusline-setup"], // routed like the placeholder
  routeBuiltins: true,
  roles: {
    Explore: ["explore", "explain"],
    investigator: ["status", "debug", "research"],
    planner: ["plan", "architecture"],
    implementer: ["implement", "bugfix", "refactor", "tests", "migration", "cicd", "docs"],
    reviewer: ["review", "review-plan", "security"],
  },
  // Model aliases used by the table. Prices: ~/.claude/pricing.json.
  models: {
    luna:  "gpt-6-luna",                    // $0.10/$0.50  text: summaries, docs
    flash: "fireworks/deepseek-v4.1-flash", // $0.22/$0.66  cheap agentic work
    pro:   "fireworks/deepseek-v4-pro",     // $1.32/$3.96  coding with judgement
    sol:   "gpt-6-sol",                     // $2/$10       reasoning: plans, design, review, hard implementation
    opus:  "claude-opus-5-5",               // $4/$20       critical: security, architecture, root cause
    web:   "gpt-6-luna",                    // $0.10/$0.50 + $0.01/search — native web search through the gateway (webSearch:true in its catalogue; also gpt-6-sol, gemini-*-flash*, claude-*; NOT the fireworks/deepseek models)
  },
  // (use case, complexity) → [model alias, effort]. Complexity signals are what Jev / the rules look at.
  useCases: {
    explore:      { label: "locate code",            rules: ["find where", "where is", "locate", "list (the )?(top-level )?folders", "grep", "usages? of"],
                    levels: { low: ["flash", "low"],   medium: ["flash", "medium"], high: ["pro", "medium"] } },
    explain:      { label: "explain / summarize",    rules: ["explain", "summari[sz]e", "what does .* do", "walk me through"],
                    levels: { low: ["luna", "low"],    medium: ["luna", "medium"],  high: ["sol", "medium"] } },
    status:       { label: "status / lookups / understand a ticket or request into acceptance criteria",       rules: ["^understand:", "acceptance criteria", "\\bglab\\b", "\\bjira\\b", "aws (describe|list|get)", "status of", "last \\d+ (merged )?(mrs|merge requests|commits)", "pipeline"],
                    levels: { low: ["flash", "low"],   medium: ["flash", "low"],    high: ["pro", "medium"] } },
    plan:         { label: "plan a ticket",          rules: ["break (it |this )?down", "plan (for|the)", "openspec", "proposal", "steps to"],
                    levels: { low: ["sol", "medium"],  medium: ["sol", "medium"],   high: ["sol", "high"] } },
    architecture: { label: "architecture / ADR",     rules: ["architect", "\\badr\\b", "design decision", "trade-?offs?", "compare .* (vs|versus)", "system design"],
                    levels: { low: ["sol", "high"],    medium: ["opus", "high"],    high: ["opus", "max"] } },
    implement:    { label: "implement feature",      rules: ["implement", "add (a |the |an )?(feature|endpoint|flag|option|field|command)", "build (a|the)", "create (a|the) (new )?"],
                    levels: { low: ["flash", "medium"], medium: ["pro", "medium"], high: ["sol", "high"] } },
    bugfix:       { label: "fix bug",                rules: ["fix", "\\bbug\\b", "wrong (value|month|result)", "returns? the wrong", "failing test", "regression"],
                    levels: { low: ["flash", "medium"], medium: ["pro", "high"],   high: ["sol", "high"] } },
    refactor:     { label: "refactor",               rules: ["refactor", "rename", "extract (a |the )?(function|class|module)", "move .* to", "simplify", "clean ?up"],
                    levels: { low: ["flash", "medium"], medium: ["pro", "medium"], high: ["sol", "high"] } },
    tests:        { label: "write tests",            rules: ["write (unit |integration |e2e )?tests", "add tests", "test coverage", "spec for"],
                    levels: { low: ["flash", "low"],   medium: ["pro", "medium"],   high: ["pro", "high"] } },
    review:       { label: "review MR / code diff",  rules: ["review", "\\bmr\\b", "merge request", "pull request", "\\bdiff\\b"],
                    levels: { low: ["sol", "medium"],  medium: ["sol", "high"],     high: ["sol", "high"] } },
    "review-plan": { label: "review a plan, spec or design document (text judgement, not code)", rules: ["^review plan:", "^review design:", "review (the|this) plan", "plan review"],
                    levels: { low: ["pro", "medium"],  medium: ["sol", "medium"],   high: ["sol", "medium"] } },
    security:     { label: "security review",        rules: ["security", "adversarial", "threat", "\\bauth", "permission", "\\bpii\\b", "secret", "injection", "jwt", "token"],
                    levels: { low: ["sol", "high"],    medium: ["opus", "high"],    high: ["opus", "max"] } },
    debug:        { label: "root cause / incident",  rules: ["root cause", "investigate", "intermittent", "not reproducible", "incident", "since (the |yesterday'?s? )?deploy", "\\b50[0-9]s?\\b"],
                    levels: { low: ["pro", "medium"],  medium: ["sol", "high"],     high: ["opus", "max"] } },
    migration:    { label: "migration",              rules: ["migrat", "backfill", "dual.?write", "rollback", "schema change", "split .* table"],
                    levels: { low: ["pro", "medium"],  medium: ["sol", "high"],     high: ["opus", "max"] } },
    research:     { label: "web research: official docs, library/API references, vendor changelogs, anything that needs a web search", rules: ["^research:", "search the web", "look ?up (online|the docs)", "official docs", "documentation (for|of) ", "latest version", "release notes of", "how does .* work in (the )?(latest|current)"],
                    levels: { low: ["web", "low"],     medium: ["web", "low"],      high: ["web", "medium"] } },
    docs:         { label: "docs / MR description",  rules: ["mr description", "release notes", "readme", "runbook", "document(ation)?", "changelog", "onboarding"],
                    levels: { low: ["luna", "low"],    medium: ["luna", "medium"],  high: ["sol", "medium"] } },
    cicd:         { label: "CI/CD / infra config",   rules: ["\\bci\\b", "pipeline", "gitlab-ci", "terraform", "kubernetes", "k8s", "helm", "dockerfile", "deploy(ment)? config"],
                    levels: { low: ["flash", "low"],   medium: ["pro", "medium"],   high: ["sol", "high"] } },
  },
  // Rules classifier: complexity signals (used when Jev is off, errors, or is below threshold).
  highPatterns: ["complexity:\\s*high", "critical", "\\bprod(uction)?\\b", "data loss", "concurren", "race condition", "distributed", "several services", "cross-service", "breaking", "not reproducible", "intermittent", "ambiguous"],
  lowPatterns: ["complexity:\\s*low", "one file", "single file", "failing test in", "at most \\d+ lines", "typo", "format", "lint", "rename", "list "],
  longPromptTokens: 2500,          // prompts above this count as a high signal
  // Jev
  jevUrl: "https://api.llmgateway.io/v1/systemone",
  jevModel: "jev-1.13.0",
  jevKeyEnv: "JEV_LLMGATEWAY_KEY",
  jevPromptChars: 800,
  jevTimeoutMs: 2500, // must stay well under the hook timeout in settings.json (apply-watch sets Agent → 20s)
  jevMinConfidence: 0.6,           // for use_case
  jevHighThreshold: 0.65,          // P(high) needed to accept "high" (clear cases score 1.00; a doubtful plan scored 0.60)
  jevCriteria: {                   // complexity criteria sent to Jev (the "tuned" variant of jev-tune.mjs: 12/15)
    low:    "The place to change is already identified (a failing test, a file, a function) or the task is a single read-only command; everything needed is stated. Mechanical changes count as low even when they touch many files (rename, imports, formatting, adding tests for existing, well-understood code).",
    medium: "The goal is clear but the code has to be found or understood before changing it; a few files; some judgement or a couple of unknowns; no production or data risk.",
    high:   "Ambiguous requirements, or spans several services, or is correctness-critical: production data, money, auth, data loss, security, or the cause of a failure is unknown.",
  },
};

// brief prefix → use case (lowercase, matched at the start of the prompt or description)
const DEFAULT_PREFIXES = { "understand:": "status", "lookup:": "status", "research:": "research", "root cause:": "debug", "plan:": "plan", "adr:": "architecture", "review plan:": "review-plan", "review design:": "review-plan", "review:": "review", "change:": "implement", "change: docs": "docs", "read-only:": "explain", "explore:": "explore" };

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(path.join(CFG_DIR, "router.json"), "utf8")); } catch {}
  const cfg = { ...DEFAULT_CONFIG, ...user };
  cfg.models = { ...DEFAULT_CONFIG.models, ...(user.models || {}) };
  cfg.useCases = { ...DEFAULT_CONFIG.useCases };
  for (const [k, v] of Object.entries(user.useCases || {})) cfg.useCases[k] = { ...(DEFAULT_CONFIG.useCases[k] || {}), ...v, levels: { ...(DEFAULT_CONFIG.useCases[k]?.levels || {}), ...(v.levels || {}) } };
  cfg.jevCriteria = { ...DEFAULT_CONFIG.jevCriteria, ...(user.jevCriteria || {}) };
  cfg.roles = { ...DEFAULT_CONFIG.roles, ...(user.roles || {}) };
  return cfg;
}
const resolve = (cfg, uc, cx) => {
  const [alias, effort] = cfg.useCases[uc]?.levels?.[cx] || ["flash", "medium"];
  return { model: cfg.models[alias] || alias, alias, effort };
};

// Find the model an agent would use by default, from its definition file.
function agentDefaults(subagentType, cwd) {
  const [plugin, name] = subagentType.includes(":") ? subagentType.split(":") : [null, subagentType];
  const candidates = [];
  if (!plugin) {
    if (cwd) candidates.push(path.join(cwd, ".claude", "agents", `${name}.md`));
    candidates.push(path.join(CFG_DIR, "agents", `${name}.md`));
  } else {
    const base = path.join(os.homedir(), ".aircode", "cache", "claude-agent-plugins");
    try { for (const h of fs.readdirSync(base)) candidates.push(path.join(base, h, "agents", `${name}.md`)); } catch {}
  }
  for (const f of candidates) {
    try {
      const s = fs.readFileSync(f, "utf8");
      return { model: s.match(/^model:\s*(.+)$/m)?.[1]?.trim() || null, effort: s.match(/^effort:\s*(.+)$/m)?.[1]?.trim() || null, file: f };
    } catch {}
  }
  return { model: null, effort: null, file: null };
}

// ── Rules classifier ───────────────────────────────────────────────────
function decideRules({ description, prompt }, cfg) {
  const text = `${description || ""}\n${prompt || ""}`.toLowerCase();
  const tokens = Math.round((prompt || "").length / 4);
  // use case: the case with most rule hits; ties → the one listed first; none → implement
  let best = null, bestHits = [];
  for (const [uc, def] of Object.entries(cfg.useCases)) {
    const hits = (def.rules || []).filter((p) => new RegExp(p, "i").test(text));
    if (hits.length > bestHits.length) { best = uc; bestHits = hits; }
  }
  const useCase = best || "explain"; // no keyword hit: read-only, cheap (Explore) rather than a code change
  const high = cfg.highPatterns.filter((p) => new RegExp(p, "i").test(text));
  const low = cfg.lowPatterns.filter((p) => new RegExp(p, "i").test(text));
  if (tokens > cfg.longPromptTokens) high.push(`prompt>${cfg.longPromptTokens}tok`);
  const complexity = high.length ? "high" : low.length ? "low" : "medium";
  return { useCase, complexity, reason: `rules: ${useCase}${bestHits.length ? " (" + bestHits.slice(0, 2).join(", ") + ")" : " (default)"}, ${complexity}${high.length ? " (" + high.slice(0, 2).join(", ") + ")" : low.length ? " (" + low.slice(0, 2).join(", ") + ")" : ""}` };
}

// ── Jev (TypeSafe System One) ─────────────────────────────────────────
async function decideJev({ subagentType, description, prompt, agentDefault }, cfg) {
  const key = process.env[cfg.jevKeyEnv];
  if (!key) return { error: `no ${cfg.jevKeyEnv} in environment` };
  const body = {
    model: cfg.jevModel,
    state: {
      subagent: subagentType, subagent_default_model: agentDefault || "inherit",
      task_description: description || "", prompt_excerpt: (prompt || "").slice(0, cfg.jevPromptChars),
      prompt_tokens_estimate: Math.round((prompt || "").length / 4),
    },
    questions: {
      use_case: { type: "choice", instructions: "A coding agent is delegating this task to a subagent. Classify the task into the single SDLC use case that best describes the main work to be done.",
        criteria: Object.fromEntries(Object.entries(cfg.useCases).map(([k, v]) => [k, v.label || k])) },
      complexity: { type: "choice", instructions: "Rate the complexity of the task. Be conservative: pick 'high' only when the task is ambiguous, spans several services, or is correctness-critical.",
        criteria: cfg.jevCriteria },
    },
  };
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.jevTimeoutMs);
    const res = await fetch(process.env.TYPESAFE_API_URL || cfg.jevUrl, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) { let detail = ""; try { detail = (await res.text()).slice(0, 200); } catch {} return { error: `HTTP ${res.status} ${detail}`.trim(), ms }; }
    const j = await res.json();
    const uc = j.answers?.use_case, cx = j.answers?.complexity;
    if (!uc?.choice || !cx?.choice) return { error: "incomplete answer", ms };
    // Accept "high" only above the threshold; otherwise the better of low/medium.
    const p = cx.probabilities || {};
    let complexity = cx.choice;
    if (complexity === "high" && (p.high ?? cx.confidence ?? 0) < cfg.jevHighThreshold) complexity = (p.medium ?? 0) >= (p.low ?? 0) ? "medium" : "low";
    return { useCase: uc.choice, useCaseConfidence: uc.confidence, complexity, complexityRaw: cx.choice, complexityConfidence: cx.confidence, probabilities: p, ms, tokens: j.usage?.input_tokens ?? null };
  } catch (e) {
    return { error: e.name === "AbortError" ? `timeout ${cfg.jevTimeoutMs}ms` : String(e.message || e), ms: Date.now() - t0 };
  }
}

// ── --dump-config: merged config as JSON (used by tools/gen-effort-variants.mjs) ──
if (process.argv[2] === "--dump-config") { console.log(JSON.stringify(loadConfig())); process.exit(0); }

// ── --criteria: print the table ────────────────────────────────────────
if (process.argv[2] === "--criteria") {
  const cfg = loadConfig();
  const B = (s) => `\x1b[1m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`;
  console.log(`Model router table (mode ${cfg.mode}, classifier ${cfg.classifier}, effort ${cfg.effortMode})\n`);
  console.log("models: " + Object.entries(cfg.models).map(([a, m]) => `${a}=${m}`).join("  ") + "\n");
  console.log("use case".padEnd(26) + LEVELS.map((l) => l.padEnd(16)).join(""));
  for (const [uc, def] of Object.entries(cfg.useCases))
    console.log(B(uc.padEnd(14)) + D((def.label || "").slice(0, 11).padEnd(12)) + LEVELS.map((l) => { const [a, e] = def.levels[l]; return `${a}·${e}`.padEnd(16); }).join(""));
  console.log("\ncomplexity criteria sent to Jev:");
  for (const l of LEVELS) console.log(`  ${B(l.padEnd(7))} ${cfg.jevCriteria[l]}`);
  console.log(D(`\nP(high) must be ≥ ${cfg.jevHighThreshold} to accept "high". Edit ~/.claude/router.json to change anything here.`));
  process.exit(0);
}

// ── --report ───────────────────────────────────────────────────────────
if (process.argv[2] === "--report") {
  const days = Number(process.argv[3] || 7), since = Date.now() - days * 86400000;
  let rows = [];
  try { rows = fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.use_case && new Date(r.ts).getTime() >= since); } catch {}
  if (!rows.length) { console.log(`No router decisions in the last ${days} days (${LOG}).`); process.exit(0); }
  const cfg = loadConfig();
  console.log(`Model router — last ${days} days — ${rows.length} launches — mode now: ${cfg.mode}\n`);
  const cell = new Map();
  for (const r of rows) { const k = `${r.use_case}/${r.complexity}`; const c = cell.get(k) || { n: 0, change: 0, applied: 0, model: r.decision, effort: r.effort }; c.n++; if (r.would_change) c.change++; if (r.applied) c.applied++; cell.set(k, c); }
  console.log("use case / complexity".padEnd(28) + "launches  would change  applied  → model · effort");
  for (const [k, c] of [...cell].sort((a, b) => b[1].n - a[1].n))
    console.log(k.padEnd(28) + String(c.n).padStart(8) + String(c.change).padStart(14) + String(c.applied).padStart(9) + `  ${c.model} · ${c.effort}`);
  const viaVariant = rows.filter((r) => r.variant).length, noVariant = rows.filter((r) => !r.variant && r.mode === "enforce" && !String(r.launched_as || r.subagent).includes(":")).length;
  console.log(`\nEffort: applied through an agent variant in ${viaVariant}/${rows.length} launches` + (noVariant ? ` · ${noVariant} enforce launches had no "<agent>--<effort>" file (run tools/gen-effort-variants.mjs)` : "") +
    ` · by effort: ` + ["low", "medium", "high", "max"].map((e) => `${e} ${rows.filter((r) => r.effort === e).length}`).join(", "));
  const rm = rows.filter((r) => r.role_mismatch);
  if (rm.length) {
    const top = [...rm.reduce((m, r) => m.set(`${r.subagent} → ${r.role_implied} (${r.use_case})`, (m.get(`${r.subagent} → ${r.role_implied} (${r.use_case})`) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`\nRole: ${rm.length}/${rows.length} launches where Jev's use case implies another role than the lead chose (${rows.filter((r) => r.role_applied).length} rewritten; roleMode ${cfg.roleMode}) — ` + top.map(([k, n]) => `${k} ×${n}`).join(", "));
  }
  const jr = rows.filter((r) => r.jev);
  if (jr.length) {
    const ok = jr.filter((r) => !r.jev.error);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const agreeUc = ok.filter((r) => r.jev.useCase === r.rules?.useCase).length, agreeCx = ok.filter((r) => r.jev.complexity === r.rules?.complexity).length;
    console.log(`\nJev: ${jr.length} calls · ${jr.length - ok.length} errors · agrees with rules: use case ${ok.length ? Math.round(100 * agreeUc / ok.length) : 0}%, complexity ${ok.length ? Math.round(100 * agreeCx / ok.length) : 0}% · ` +
      `high accepted ${ok.filter((r) => r.jev.complexity === "high").length}, high rejected by threshold ${ok.filter((r) => r.jev.complexityRaw === "high" && r.jev.complexity !== "high").length} · avg conf ${avg(ok.map((r) => r.jev.useCaseConfidence || 0)).toFixed(2)}/${avg(ok.map((r) => r.jev.complexityConfidence || 0)).toFixed(2)} · avg ${Math.round(avg(ok.map((r) => r.jev.ms || 0)))} ms`);
    const errs = [...new Set(jr.filter((r) => r.jev.error).map((r) => r.jev.error))];
    if (errs.length) console.log("  errors: " + errs.join(" | "));
    const dis = ok.filter((r) => r.jev.useCase !== r.rules?.useCase || r.jev.complexity !== r.rules?.complexity).slice(-8);
    if (dis.length) { console.log("  disagreements (rules → jev):"); for (const r of dis) console.log(`    ${r.subagent.padEnd(20)} ${r.rules.useCase}/${r.rules.complexity} → ${r.jev.useCase}/${r.jev.complexity}  "${(r.description || "").slice(0, 60)}"`); }
  }
  console.log("\nLast 10 decisions that would change the model:");
  for (const r of rows.filter((x) => x.would_change).slice(-10))
    console.log(`  ${r.ts.slice(5, 16).replace("T", " ")}  ${r.subagent.padEnd(20)} ${String(r.effective_default).padEnd(30)} → ${r.decision} · ${r.effort}   (${r.use_case}/${r.complexity}; ${r.reason})\n      "${(r.description || "").slice(0, 80)}"`);
  console.log("\nCost per agent: cc-cost --days " + days + " --all");
  process.exit(0);
}

// ── Hook mode ──────────────────────────────────────────────────────────
let out = null;
try {
  const d = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  const cfg = loadConfig();
  const input = d.tool_input || {};
  if (cfg.mode !== "off" && input && typeof input === "object") {
    const subagentType = input.subagent_type || "general-purpose";
    const requested = input.model || null;
    const agent = agentDefaults(subagentType, d.cwd);
    const effectiveDefault = requested || agent.model || "(inherit)";
    const rules = decideRules({ description: input.description, prompt: input.prompt }, cfg);
    let jev = null, dec = { ...rules, source: "rules" };
    if (cfg.classifier === "jev" || cfg.classifier === "both") {
      jev = await decideJev({ subagentType, description: input.description, prompt: input.prompt, agentDefault: agent.model }, cfg);
      if (cfg.classifier === "jev" && !jev.error && cfg.useCases[jev.useCase] && (jev.useCaseConfidence ?? 0) >= cfg.jevMinConfidence)
        dec = { useCase: jev.useCase, complexity: jev.complexity, reason: `jev (${Number(jev.useCaseConfidence).toFixed(2)}/${Number(jev.complexityConfidence).toFixed(2)})`, source: "jev" };
    }
    // Brief prefixes are a contract with the lead/commands: they fix the use case (and so the role) deterministically;
    // Jev still decides the complexity. Configurable via router.json "briefPrefixes".
    const prefixes = cfg.briefPrefixes || DEFAULT_PREFIXES;
    const head = `${input.description || ""}\n${input.prompt || ""}`.trimStart().slice(0, 40).toLowerCase();
    const pf = Object.entries(prefixes).sort((a, b) => b[0].length - a[0].length).find(([k]) => head.startsWith(k) || String(input.prompt || "").trimStart().toLowerCase().startsWith(k));
    if (pf && cfg.useCases[pf[1]] && dec.useCase !== pf[1]) dec = { ...dec, useCase: pf[1], reason: `prefix "${pf[0]}" → ${pf[1]} (${dec.reason})`, source: dec.source === "jev" ? "jev+prefix" : "rules+prefix" };
    const pick = resolve(cfg, dec.useCase, dec.complexity);
    const wouldChange = !requested && pick.model !== effectiveDefault;
    let apply = false; // set below: true when the launch is rewritten to a variant that carries the table's model
    // role: the use case implies a role; compare with what the lead chose (our roles only)
    const chosenBase = subagentType.replace(/--(?:[a-z0-9]+-)?(low|medium|high|xhigh|max)$/, "");
    const impliedRole = Object.entries(cfg.roles).find(([, cases]) => cases.includes(dec.useCase))?.[0] || null;
    // Claude Code's built-in agents (general-purpose, Plan, …) are treated like the placeholder: the lead must not use
    // them directly (all tools, session model, no role prompt), so the router assigns one of our roles instead.
    const isBuiltin = (cfg.builtinAgents || []).includes(chosenBase);
    const isPlaceholder = chosenBase === cfg.placeholder || (isBuiltin && cfg.routeBuiltins !== false);
    const roleKnown = Object.keys(cfg.roles).includes(chosenBase);
    const confident = dec.source === "jev" ? (jev?.useCaseConfidence ?? 0) >= cfg.jevMinConfidence : true;
    const roleMismatch = (roleKnown && impliedRole && impliedRole !== chosenBase && confident) || isPlaceholder;
    // placeholder: always assign (implied role, or implementer as the safe default for an unknown case); others: enforce mode only
    const roleApply = isPlaceholder ? cfg.mode !== "off" : (roleMismatch && cfg.roleMode === "enforce" && cfg.mode === "enforce");
    const targetRole = impliedRole || "implementer";
    // effort: via an agent variant "<base>--<effort>" (generated file) when effortMode is "variant"
    const baseType = roleApply ? targetRole : chosenBase;
    let variant = null;
    // The Agent tool only accepts model aliases (sonnet|opus|haiku|fable) in updatedInput, so the model is never
    // rewritten here: it lives in the variant's frontmatter. Variant = <role>--<model alias>-<effort>.
    if (cfg.effortMode === "variant" && !subagentType.includes(":") && (cfg.mode === "enforce" || isPlaceholder)) {
      const v = `${baseType}--${pick.alias}-${pick.effort}`;
      if (v !== subagentType && agentDefaults(v, d.cwd).file) variant = v;
    }
    if ((roleApply || isPlaceholder) && !variant) variant = baseType; // no variant file: launch the base role (its own default model)



    if (variant) {
      apply = wouldChange && variant.includes("--");
      out = { hookSpecificOutput: {
        hookEventName: "PreToolUse", permissionDecision: "allow",
        permissionDecisionReason: `model-router: ${dec.useCase}/${dec.complexity} → ${pick.model} · ${pick.effort} (agent ${variant})${roleApply ? ` [role ${chosenBase} → ${targetRole}]` : ""}`,
        updatedInput: { ...input, subagent_type: variant },
      } };
    }
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({
      ts: new Date().toISOString(), session_id: d.session_id, launcher: d.agent_type ?? null, tool_use_id: d.tool_use_id ?? null,
      mode: cfg.mode, subagent: chosenBase, subagent_final: baseType, launched_as: subagentType, description: input.description ?? null, prompt_tokens: Math.round((input.prompt || "").length / 4),
      requested, agent_default: agent.model, agent_effort: agent.effort || d.effort || null, effective_default: effectiveDefault,
      use_case: dec.useCase, complexity: dec.complexity, decision: pick.model, alias: pick.alias, effort: pick.effort,
      reason: dec.reason, source: dec.source, classifier: cfg.classifier, rules: { useCase: rules.useCase, complexity: rules.complexity }, jev,
      role_implied: impliedRole, role_mismatch: !!roleMismatch, role_applied: !!roleApply, builtin: isBuiltin,
      would_change: wouldChange, applied: apply, variant, effort_applied: variant ? pick.effort : (agent.effort || null), tiers: cfg.models,
    }) + "\n");
  }
} catch {
  // Never break a launch because of the router.
}
if (out) process.stdout.write(JSON.stringify(out));
process.exit(0);
