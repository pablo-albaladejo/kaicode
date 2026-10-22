#!/usr/bin/env node
// router-set <key> <json>: changes ONE tuning value in ~/.claude/router.json (backup first: router.json.bak-<ts>).
// Allowed keys only: useCases.<case>.levels.<low|medium|high> = ["<alias>","<effort>"], models.<alias> = "<model id>", shipBudgetUsd, jevTimeoutMs,
// shipBudgetBySize = {"S":n,"M":n,"L":n}. Anything else is refused. Used by kai-runner so a reviewer can tune routing.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const CL = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), F = path.join(CL, "router.json");
const [key, raw] = process.argv.slice(2);
const die = (m) => { console.error("router-set: " + m); process.exit(2); };
if (!key || raw == null) die("usage: router-set <key> <json>");
let v; try { v = JSON.parse(raw); } catch { die("value is not JSON"); }
const cfg = JSON.parse(fs.readFileSync(F, "utf8"));
const ALIASES = Object.keys(cfg.models || {}).concat(["luna", "flash", "pro", "sol", "opus", "web", "fable"]);
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
let m;
if ((m = key.match(/^useCases\.([a-z-]+)\.levels\.(low|medium|high)$/))) {
  if (!Array.isArray(v) || v.length !== 2 || !ALIASES.includes(v[0]) || !EFFORTS.includes(v[1])) die(`value must be ["<alias>","<effort>"], alias one of ${[...new Set(ALIASES)].join(" ")}`);
  cfg.useCases = cfg.useCases || {}; cfg.useCases[m[1]] = cfg.useCases[m[1]] || {}; cfg.useCases[m[1]].levels = { ...(cfg.useCases[m[1]].levels || {}), [m[2]]: v };
} else if ((m = key.match(/^models\.([a-z][a-z0-9-]{1,15})$/))) {
  let prices = {}; try { prices = JSON.parse(fs.readFileSync(path.join(CL, "pricing.json"), "utf8")); } catch {}
  if (typeof v !== "string" || !(prices[v] || prices[v.split("/").pop()])) die(`model ${v} is not in pricing.json (run pricing-sync first)`);
  cfg.models = { ...(cfg.models || {}), [m[1]]: v };
} else if (key === "shipBudgetUsd" || key === "jevTimeoutMs") {
  if (typeof v !== "number" || v <= 0 || v > (key === "jevTimeoutMs" ? 20000 : 200)) die("number out of range"); cfg[key] = v;
} else if (key === "shipBudgetBySize") {
  if (!v || !["S", "M", "L"].every((k) => typeof v[k] === "number" && v[k] > 0 && v[k] <= 200)) die('value must be {"S":n,"M":n,"L":n}'); cfg[key] = v;
} else die(`key not allowed: ${key}`);
fs.copyFileSync(F, `${F}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.writeFileSync(F, JSON.stringify(cfg, null, 2) + "\n");
console.log(`router.json: ${key} = ${JSON.stringify(v)}`);
// new (model, effort) pairs need their agent variant files, or the router falls back to the base agent
try { execFileSync(process.execPath, [path.join(CL, "tools", "gen-effort-variants.mjs")], { stdio: "ignore" }); for (const f of fs.readdirSync(path.join(CL, "agents"))) if (/^(lead|lead-fable|solo|browser)--/.test(f)) fs.unlinkSync(path.join(CL, "agents", f)); console.log("variants regenerated"); } catch (e) { console.log("variants: " + e.message); }
