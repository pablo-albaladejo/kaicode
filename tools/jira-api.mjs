#!/usr/bin/env node
// jira-api: small Jira Cloud REST client for the harness. Credentials are read here and never printed:
// ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json) .mcpServers.jira.env.{ATLASSIAN_API_TOKEN,ATLASSIAN_USER_EMAIL},
// else the acli token in the macOS Keychain.
//   jira-api get <KEY>                 issue as JSON: key fields, description in ADF, attachments, non-empty custom fields
//   jira-api attachments <KEY> [--out dir] [--all]   download the attachments (default dir .claude/jira/<KEY>/, files
//                                      over 25 MB skipped unless --all) and print one line per file: path · type · size
//   jira-api create <issue.json>       POST /rest/api/3/issue with {"fields":{…}} (description in ADF). A Jira write:
//                                      bash-guard requires the user's go-ahead (CC_CONFIRMED=1).
//   jira-api create <issue.json> --dry-run   validate and print what would be sent
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

function creds() {
  for (const f of [process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"), path.join(os.homedir(), ".claude.json")].filter(Boolean)) {
    try { const e = JSON.parse(fs.readFileSync(f, "utf8")).mcpServers?.jira?.env || {}; if (e.ATLASSIAN_API_TOKEN) return { token: e.ATLASSIAN_API_TOKEN, email: e.ATLASSIAN_USER_EMAIL || e.JIRA_USERNAME, site: (e.JIRA_URL || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || null }; } catch {}
  }
  try { const cfg = fs.readFileSync(path.join(os.homedir(), ".config/acli/jira_config.yaml"), "utf8"); const fld = (n) => new RegExp(`${n}:\\s*(\\S+)`).exec(cfg)?.[1];
    const raw = execFileSync("security", ["find-generic-password", "-s", "acli", "-a", `jira:${fld("cloud_id")}:${fld("account_id")}`, "-w"], { encoding: "utf8" }).trim();
    return { token: raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice(18), "base64").toString("utf8") : raw, email: fld("email"), site: fld("site") }; } catch {}
  return null;
}
const c = creds(); if (!c?.token || !c.email) { console.error("jira-api: no Jira credentials (.mcpServers.jira.env in ~/.claude.json, or acli login). Do not paste tokens in chat."); process.exit(1); }
const SITE = `https://${c.site || "aircall-product.atlassian.net"}`;
const auth = "Basic " + Buffer.from(`${c.email}:${c.token}`).toString("base64");
const api = async (method, p, body) => { const r = await fetch(SITE + p, { method, headers: { Authorization: auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; };

const [cmd, arg, ...rest] = process.argv.slice(2);
if (cmd === "get" && /^[A-Z][A-Z0-9]+-\d+$/.test(arg || "")) {
  const r = await api("GET", `/rest/api/3/issue/${arg}?expand=names`);
  if (r.status !== 200) { console.error(`GET ${arg} → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`); process.exit(1); }
  const f = r.body.fields, names = r.body.names || {};
  const custom = Object.fromEntries(Object.entries(f).filter(([k, v]) => k.startsWith("customfield_") && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => [`${k} (${names[k] || "?"})`, v]));
  console.log(JSON.stringify({ key: r.body.key, summary: f.summary, issuetype: f.issuetype?.name, project: f.project?.key, status: f.status?.name, priority: f.priority?.name, labels: f.labels, components: (f.components || []).map((x) => x.name), parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary } : null, assignee: f.assignee?.displayName, reporter: f.reporter?.displayName, issuelinks: (f.issuelinks || []).map((l) => `${l.type?.name}: ${(l.outwardIssue || l.inwardIssue)?.key}`), attachments: (f.attachment || []).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, created: a.created?.slice(0, 10), author: a.author?.displayName })), custom, description: f.description }, null, 2));
} else if (cmd === "attachments" && /^[A-Z][A-Z0-9]+-\d+$/.test(arg || "")) {
  const r = await api("GET", `/rest/api/3/issue/${arg}?fields=attachment`);
  if (r.status !== 200) { console.error(`GET ${arg} → HTTP ${r.status}`); process.exit(1); }
  const list = r.body.fields?.attachment || [];
  if (!list.length) { console.log(`${arg}: no attachments`); process.exit(0); }
  const oi = rest.indexOf("--out"), dir = oi >= 0 ? rest[oi + 1] : path.join(".claude", "jira", arg); fs.mkdirSync(dir, { recursive: true });
  // keep downloads out of the product repo's commits: .claude/jira/ goes to .git/info/exclude (same as .claude/ship/)
  try { const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); const ex = path.join(common, "info", "exclude"); const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : ""; if (!/^\.claude\/jira\/?$/m.test(cur)) { fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, (cur && !cur.endsWith("\n") ? "\n" : "") + ".claude/jira/\n"); } } catch {}
  for (const a of list) {
    const safe = `${a.id}-${String(a.filename).replace(/[^\w.@+-]+/g, "_")}`, out = path.join(dir, safe);
    if (a.size > 25 * 1024 * 1024 && !rest.includes("--all")) { console.log(`skipped (${(a.size / 1048576).toFixed(1)} MB, use --all) · ${a.filename} · ${a.mimeType}`); continue; }
    if (!fs.existsSync(out)) { const res = await fetch(a.content, { headers: { Authorization: auth } }); if (!res.ok) { console.log(`failed HTTP ${res.status} · ${a.filename}`); continue; } fs.writeFileSync(out, Buffer.from(await res.arrayBuffer())); }
    console.log(`${out} · ${a.mimeType} · ${(a.size / 1024).toFixed(0)} KB · ${a.created?.slice(0, 10)} · ${a.author?.displayName || ""}`);
  }
} else if (cmd === "create" && arg) {
  const issue = JSON.parse(fs.readFileSync(arg, "utf8"));
  const F = issue.fields || {}; const miss = ["project", "issuetype", "summary", "description"].filter((k) => !F[k]);
  if (miss.length) { console.error(`jira-api: missing fields: ${miss.join(", ")}`); process.exit(1); }
  if (F.description?.type !== "doc" || F.description?.version !== 1) { console.error("jira-api: description must be ADF ({type:'doc',version:1,content:[…]})"); process.exit(1); }
  if (rest.includes("--dry-run")) { console.log(`would create in ${F.project.key}: [${F.issuetype.name}] ${F.summary}${F.parent ? ` (parent ${F.parent.key})` : ""}`); process.exit(0); }
  const r = await api("POST", "/rest/api/3/issue", issue);
  if (r.status !== 201) { console.error(`create → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`); process.exit(1); }
  console.log(`created ${r.body.key}: ${SITE}/browse/${r.body.key}`);
} else { console.error("usage: jira-api get <KEY> | attachments <KEY> [--out dir] [--all] | create <issue.json> [--dry-run]"); process.exit(1); }
