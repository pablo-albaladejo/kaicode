#!/usr/bin/env node
// Jev tuning bench: runs a set of realistic subagent tasks through Jev with three criteria styles
// (short / medium / long descriptions) and prints use_case, complexity, confidence, latency and tokens.
// Usage:  node ~/.claude-work/tools/jev-tune.mjs [--variants short,medium,long,tuned] [--json]   (default: tuned)
const URL_ = process.env.JEV_URL || "https://api.llmgateway.io/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";
const KEY = process.env.JEV_LLMGATEWAY_KEY;
if (!KEY) { console.error("JEV_LLMGATEWAY_KEY not set"); process.exit(1); }
const argv = process.argv.slice(2);
const variants = (argv.includes("--variants") ? argv[argv.indexOf("--variants") + 1] : "tuned").split(",");
const asJson = argv.includes("--json");

// ── criteria variants ─────────────────────────────────────────────────
const CASES = {
  explore:      ["locate code",                 "Locate code: find files, symbols, usages; list folders; grep",                                   "Find where something lives in the codebase: files, symbols, call sites, folder layout, naming conventions. Read-only, no judgement about quality."],
  explain:      ["explain / summarize",         "Explain or summarize code, a diff, a ticket or a log",                                           "Produce a written explanation or summary of existing material: how a module works, what a diff changes, what a ticket asks for, what a log shows."],
  status:       ["status / lookups",            "Status checks and lookups with git, glab, jira or aws commands",                                  "Run read-only commands (git, glab, jira, aws describe) and report their output: MR state, pipeline status, deployed version, ticket fields."],
  plan:         ["plan a ticket",               "Break a ticket or request down into steps; OpenSpec proposal",                                    "Turn a ticket or request into an ordered set of steps, files to touch and open questions; write an OpenSpec proposal. No code changes."],
  architecture: ["architecture / ADR",          "Design decision, ADR, system or component design, trade-offs",                                    "Decide how something should be built: compare options, write an ADR, design a component or system boundary, analyse trade-offs and migration paths."],
  implement:    ["implement feature",           "Build a feature or behaviour change from a spec",                                                 "Write new code that adds a feature or changes behaviour according to a spec or ticket, including small supporting tests."],
  bugfix:       ["fix bug",                     "Fix a defect with a known or reproducible failure",                                               "Correct a defect: reproduce it, find the faulty code, change it and add a regression test. The failure is known or reproducible."],
  refactor:     ["refactor",                    "Restructure code without changing behaviour",                                                     "Change the structure of existing code (extract, rename, move, simplify) while keeping behaviour and public APIs identical."],
  tests:        ["write tests",                 "Write or extend unit, integration or e2e tests",                                                  "Add or extend automated tests (unit, integration, contract, e2e) for existing code, including fixtures and mocks."],
  review:       ["review MR",                   "Review a merge request or diff for correctness and style",                                        "Read a merge request or diff and report problems: correctness, edge cases, error handling, style, missing tests. No security focus."],
  security:     ["security review",             "Security review: auth, permissions, PII, secrets, input validation",                              "Review code or a change specifically for security: authentication, authorisation, PII handling, secrets, input validation, injection, attack surface."],
  debug:        ["root cause / incident",       "Root-cause analysis of an incident or unexplained failure",                                       "Investigate an incident or unexplained failure whose cause is unknown: correlate logs, metrics and code across components to find the root cause."],
  migration:    ["migration",                   "Data, schema or infrastructure migration with rollback concerns",                                 "Plan or execute a data, schema or infrastructure migration: backfills, dual writes, rollback plan, cross-service coordination."],
  docs:         ["docs / MR description",       "Documentation, MR description, release notes, runbooks",                                          "Write prose for humans: README sections, MR descriptions, release notes, runbooks, onboarding guides."],
  cicd:         ["CI/CD / infra config",        "CI/CD pipelines, terraform, kubernetes or other infra config",                                    "Change build or deployment configuration: GitLab CI jobs, terraform, kubernetes manifests, environment variables, secrets wiring."],
};
const COMPLEXITY = {
  short:  { low: "trivial", medium: "moderate", high: "hard or risky" },
  medium: { low: "Fully specified, one file or one command, no judgement needed", medium: "Clear goal, a few files, some judgement or unknowns", high: "Ambiguous spec, many files or services, or correctness-critical" },
  long:   { low: "Everything needed is stated; touches one file or runs one command; a junior engineer would do it without asking questions.",
            medium: "The goal is clear but the path is not fully spelled out; touches a few files; needs some judgement or has a couple of unknowns.",
            high: "Ambiguous requirements, or spans many files or several services, or is correctness-critical: production data, money, auth, data loss, security." },
};
// "tuned": short use-case criteria + revised long complexity criteria (from the first bench run).
COMPLEXITY.tuned = {
  low:    "The place to change is already identified (a failing test, a file, a function) or the task is a single read-only command; everything needed is stated. Mechanical changes count as low even when they touch many files (rename, imports, formatting, adding tests for existing, well-understood code).",
  medium: "The goal is clear but the code has to be found or understood before changing it; a few files; some judgement or a couple of unknowns; no production or data risk.",
  high:   "Ambiguous requirements, or spans several services, or is correctness-critical: production data, money, auth, data loss, security, or the cause of a failure is unknown.",
};
const VI = { short: 0, medium: 1, long: 2, tuned: 0 };
const criteria = (variant) => Object.fromEntries(Object.entries(CASES).map(([k, v]) => [k, v[VI[variant]]]));

// ── test tasks (expected answers are my guess; disagreements are the interesting part) ──
const TASKS = [
  { sub: "Explore",      desc: "List top-level folders",             prompt: "List the top-level folders of this repo and say what each one is for.", expect: ["explore", "low"] },
  { sub: "investigator", desc: "Last merged MRs",                    prompt: "Use glab to list the last 5 merged MRs on this project with author and date.", expect: ["status", "low"] },
  { sub: "implementer",  desc: "Retry with backoff in webhook sender", prompt: "Implement exponential backoff (3 retries, jitter) in services/webhooks/sender.ts following the existing RetryPolicy in lib/http. Add unit tests. Do not change the public API.", expect: ["implement", "medium"] },
  { sub: "implementer",  desc: "Fix date parsing bug",               prompt: "parseDate() returns the wrong month for ISO strings with a timezone offset. Failing test in date.spec.ts:42. Fix it.", expect: ["bugfix", "low"] },
  { sub: "implementer",  desc: "Intermittent 502s after deploy",     prompt: "Since yesterday's deploy ~2% of requests to /v1/calls return 502. Not reproducible locally. Investigate across the gateway logs, the ECS service events and the recent diffs and find the root cause.", expect: ["debug", "high"] },
  { sub: "reviewer",     desc: "Review MR !4821",                    prompt: "Review the diff of MR !4821 (adds a feature flag check in the dialer UI, 60 lines). Report correctness and style issues.", expect: ["review", "low"] },
  { sub: "reviewer",     desc: "Security review of auth middleware",  prompt: "Adversarial review of the new JWT validation middleware in api/auth: token expiry, audience checks, key rotation, and anything that could let a request through unauthenticated.", expect: ["security", "high"] },
  { sub: "implementer",  desc: "Add tests for RetryPolicy",          prompt: "Write unit tests for lib/http/RetryPolicy covering max retries, jitter bounds and the give-up path.", expect: ["tests", "low"] },
  { sub: "implementer",  desc: "Split company-context table",        prompt: "Plan and implement the migration that splits company_context into company_settings and company_documents: backfill, dual write for one release, rollback plan. Three services read this table.", expect: ["migration", "high"] },
  { sub: "Explore",      desc: "Explain the ingestion pipeline",     prompt: "Explain how the document ingestion pipeline works end to end, from the S3 event to the vector store write.", expect: ["explain", "medium"] },
  { sub: "planner",      desc: "Plan APR-7242",                      prompt: "Break down ticket APR-7242 (live company context in the agent prompt) into implementation steps with files to touch and open questions. Write an OpenSpec proposal.", expect: ["plan", "medium"] },
  { sub: "planner",      desc: "Queue vs stream for events",         prompt: "We need to fan out call events to 4 consumers with at-least-once delivery. Compare SQS+SNS vs Kinesis vs EventBridge for our volume (2k/s peak) and write an ADR.", expect: ["architecture", "high"] },
  { sub: "implementer",  desc: "Rename helper",                      prompt: "Rename getCompanyCtx to getCompanyContext across the repo and fix imports.", expect: ["refactor", "low"] },
  { sub: "implementer",  desc: "MR description",                     prompt: "Write the MR description for the current branch from the diff against main.", expect: ["docs", "low"] },
  { sub: "implementer",  desc: "Add a CI job",                       prompt: "Add a GitLab CI job that runs the contract tests on merge requests touching packages/api.", expect: ["cicd", "medium"] },
];

async function ask(variant, t) {
  const body = {
    model: MODEL,
    state: { subagent: t.sub, task_description: t.desc, prompt_excerpt: t.prompt.slice(0, 800), prompt_tokens_estimate: Math.round(t.prompt.length / 4) },
    questions: {
      use_case:   { type: "choice", instructions: "A coding agent is delegating this task to a subagent. Classify the task into the single SDLC use case that best describes the main work to be done.", criteria: criteria(variant) },
      complexity: { type: "choice", instructions: "Rate the complexity of the task. Be conservative: pick 'high' only when the task is ambiguous, spans many files or services, or is correctness-critical.", criteria: COMPLEXITY[variant] },
    },
  };
  const t0 = Date.now();
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) return { error: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`, ms };
  const j = await res.json();
  return { uc: j.answers?.use_case, cx: j.answers?.complexity, ms, tokens: j.usage?.input_tokens ?? j.usage?.prompt_tokens ?? null };
}

const results = [];
for (const variant of variants) {
  console.log(`\n\x1b[1m── criteria: ${variant} ──\x1b[0m`);
  console.log("task".padEnd(34) + "expected".padEnd(20) + "use_case (conf)".padEnd(24) + "complexity (conf)".padEnd(22) + "ms   tokens");
  let okUc = 0, okCx = 0, n = 0, sumMs = 0, sumConfUc = 0, sumConfCx = 0, toks = null;
  for (const t of TASKS) {
    const r = await ask(variant, t);
    results.push({ variant, task: t.desc, ...r });
    if (r.error) { console.log(t.desc.padEnd(34) + "\x1b[31m" + r.error + "\x1b[0m"); continue; }
    n++; sumMs += r.ms; toks = r.tokens ?? toks;
    const ucOk = r.uc?.choice === t.expect[0], cxOk = r.cx?.choice === t.expect[1];
    okUc += ucOk; okCx += cxOk; sumConfUc += r.uc?.confidence || 0; sumConfCx += r.cx?.confidence || 0;
    const mark = (ok) => (ok ? "\x1b[32m" : "\x1b[33m");
    console.log(t.desc.padEnd(34) + `${t.expect[0]}/${t.expect[1]}`.padEnd(20) +
      mark(ucOk) + `${r.uc?.choice} (${Number(r.uc?.confidence).toFixed(2)})`.padEnd(24) + "\x1b[0m" +
      mark(cxOk) + `${r.cx?.choice} (${Number(r.cx?.confidence).toFixed(2)})`.padEnd(22) + "\x1b[0m" +
      String(r.ms).padStart(4) + "   " + (r.tokens ?? "-") +
      (r.cx?.probabilities ? "   p(l/m/h) " + ["low", "medium", "high"].map((k) => Number(r.cx.probabilities[k] || 0).toFixed(2)).join("/") : ""));
  }
  if (n) console.log(`\n  use_case match ${okUc}/${n} · complexity match ${okCx}/${n} · avg conf ${(sumConfUc / n).toFixed(2)} / ${(sumConfCx / n).toFixed(2)} · avg ${Math.round(sumMs / n)} ms · ~${toks ?? "?"} input tokens/call`);
}
if (asJson) console.log("\n" + JSON.stringify(results, null, 1));
