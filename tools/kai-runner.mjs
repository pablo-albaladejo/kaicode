#!/usr/bin/env node
// kai-runner: lets a reviewer that cannot reach ~/.claude (a Cowork session, which only sees ~/.claude-work) run a
// FIXED list of harness commands on this Mac, without copy and paste. It is not a shell: every request is checked
// against the allowlist below and run with execFile (no shell, no free text).
//   queue:   ~/.claude-work/.kaicode-queue/<id>.json   {"cmd": "status", "args": []}
//   output:  ~/.claude-work/.kaicode-review/out/<id>.txt   (+ status.diff and local/base copies, refreshed every run)
// Run by launchd (apply-runner.sh) when the queue folder changes and every 10 minutes. Log: ~/.claude/logs/kai-runner.log
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q = path.join(REPO, ".kaicode-queue"), OUT = path.join(REPO, ".kaicode-review", "out");
const CL = path.join(os.homedir(), ".claude"), LOG = path.join(CL, "logs", "kai-runner.log");
const NODE = process.execPath, KAI = path.join(REPO, "tools", "kai-install.mjs");
const SAFE_PATH = /^(agents|commands|hooks|tools|templates|skill-src)\/[A-Za-z0-9._\/-]+$|^statusline\.mjs$/;
const LOGS = { sweep: "sweep.log", runner: "kai-runner.log", router: "model-router.jsonl", guards: "guards.jsonl" };
const paths = (a) => { const bad = a.filter((p) => !SAFE_PATH.test(p) || p.includes("..")); if (bad.length) throw new Error(`not a harness path: ${bad.join(" ")}`); if (!a.length) throw new Error("give at least one path"); return a; };

// cmd → [file, argv] ; everything here is read-only or a kai-install action (3-way merge, never an overwrite)
const ALLOW = {
  "status":     () => [NODE, [KAI, "--status"]],
  "dry-run":    (a) => [NODE, [KAI, "--dry-run", ...(a.length ? paths(a) : [])]],
  "install":    (a) => [NODE, [KAI, ...paths(a)]],
  "adopt":      (a) => [NODE, [KAI, "--adopt", ...paths(a)]],
  "cost":       (a) => [NODE, [path.join(CL, "tools", "cc-cost.mjs"), "--days", String(Math.min(30, Math.max(1, parseInt(a[0] || "1", 10) || 1))), "--all", ...(a[1] === "json" ? ["--json"] : [])]],
  "log":        (a) => { const f = LOGS[a[0]]; if (!f) throw new Error(`log one of: ${Object.keys(LOGS).join(" ")}`); return ["tail", ["-n", String(Math.min(400, parseInt(a[1] || "80", 10) || 80)), path.join(CL, "logs", f)]]; },
  "ls":         (a) => { const d = a[0] || "."; if (!/^(agents|commands|hooks|tools|templates|knowledge|logs|\.kaicode)(\/[A-Za-z0-9._-]+)*$|^\.$/.test(d)) throw new Error("ls a harness folder"); return ["ls", ["-la", path.join(CL, d)]]; },
  "settings":   () => [NODE, ["-e", `const s=JSON.parse(require("fs").readFileSync(${JSON.stringify(path.join(CL, "settings.json"))},"utf8"));for(const k of Object.keys(s.env||{}))if(/KEY|TOKEN|SECRET|PASS/i.test(k))s.env[k]="<hidden>";delete s.apiKeyHelper;console.log(JSON.stringify(s,null,2))`]],
  "router":     () => ["cat", [path.join(CL, "router.json")]],
  "router-set": (a) => { if (a.length !== 2) throw new Error("router-set <key> <json>"); return [NODE, [path.join(REPO, "tools", "router-set.mjs"), a[0], a[1]]]; },
  "jira-get":   (a) => { if (!/^[A-Z][A-Z0-9]+-\d+$/.test(a[0] || "")) throw new Error("jira-get <KEY>"); return [NODE, [path.join(REPO, "tools", "jira-api.mjs"), "get", a[0]]]; },
  "gateway-models": () => [NODE, [path.join(REPO, "tools", "gateway-models.mjs"), "--out", path.join(REPO, ".kaicode-review", "gateway-models.json")]],
  "pricing-sync": () => [NODE, [path.join(REPO, "tools", "pricing-sync.mjs"), path.join(REPO, ".kaicode-review", "gateway-models.json")]],
  "model-probe": (a) => { const ms = a.filter((m) => /^[\w./:-]+$/.test(m) || /^--effort=(low|medium|high|xhigh|max)$/.test(m)).slice(0, 9); if (!ms.length) throw new Error("model-probe <model>…"); return [NODE, [path.join(REPO, "tools", "model-probe.mjs"), ...ms]]; },
  "cost-session": (a) => { if (!/^[0-9a-f-]{36}$/.test(a[0] || "")) throw new Error("cost-session <session uuid>"); return [NODE, [path.join(CL, "tools", "cc-cost.mjs"), "--session", a[0], "--json"]]; },
  // the user's own message samples (knowledge/voice-samples*.md) for the voice work; copied into the git-ignored review folder
  "voice-copy": () => ["rsync", ["-a", "--include=voice-samples*.md", "--exclude=*", path.join(CL, "knowledge") + "/", path.join(REPO, ".kaicode-review", "voice") + "/"]],
  "voice-bench": () => [NODE, [path.join(REPO, "tools", "voice-bench.mjs"), path.join(REPO, ".kaicode-review", "voice-bench", "cases.json"), path.join(REPO, "voice-bench")]],
  "pricing":    () => ["cat", [path.join(CL, "pricing.json")]],
  "scrub-logs": () => [NODE, [path.join(REPO, "tools", "log-scrub.mjs"), path.join(CL, "logs")]],
  "retro":      (a) => [NODE, [path.join(CL, "tools", "retro-report.mjs"), "--days", String(Math.min(60, Math.max(1, parseInt(a[0] || "7", 10) || 7)))]],
  // read-only copy of the harness logs (and the ship archive) into .kaicode-review/logs for analysis
  "logs-copy":  () => ["rsync", ["-a", "--delete", "--include=*/", "--include=*.jsonl", "--include=*.log", "--include=*.json", "--include=*.md", "--exclude=*", path.join(CL, "logs") + "/", path.join(REPO, ".kaicode-review", "logs") + "/"]],
};

const log = (m) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {} };
fs.mkdirSync(Q, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const run = (file, argv) => { try { return { code: 0, out: execFileSync(file, argv, { encoding: "utf8", timeout: 900000, maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}${e.message && !e.stdout ? e.message : ""}` }; } };

let did = 0;
for (const f of fs.readdirSync(Q).filter((x) => /^[A-Za-z0-9_-]+\.json$/.test(x)).sort()) {
  const id = f.slice(0, -5), qf = path.join(Q, f); let req, res;
  try { req = JSON.parse(fs.readFileSync(qf, "utf8")); } catch { req = {}; }
  fs.rmSync(qf, { force: true });
  try {
    const mk = ALLOW[req.cmd]; if (!mk) throw new Error(`unknown cmd "${req.cmd}"; allowed: ${Object.keys(ALLOW).join(" ")}`);
    const args = Array.isArray(req.args) ? req.args.map(String) : [];
    const [file, argv] = mk(args); res = run(file, argv);
  } catch (e) { res = { code: 2, out: `refused: ${e.message}\n` }; }
  fs.writeFileSync(path.join(OUT, `${id}.txt`), `$ ${req.cmd} ${(req.args || []).join(" ")}\nexit ${res.code} · ${new Date().toISOString()}\n\n${res.out}`);
  log(`${id} ${req.cmd} ${(req.args || []).join(" ")} → exit ${res.code}`); did++;
}
// always leave a fresh status for the reviewer
run(NODE, [KAI, "--status"]);
fs.writeFileSync(path.join(REPO, ".kaicode-review", "heartbeat"), `${new Date().toISOString()} ran ${did} request(s)\n`);
