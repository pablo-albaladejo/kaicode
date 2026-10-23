#!/usr/bin/env node
// confluence-read: read Confluence over REST when the Atlassian MCP is down or needs re-authentication. Read-only.
//   confluence-read get <pageId | page URL>     title, space, version, and the body as plain text (tables as | rows)
//   confluence-read search '<CQL>' [limit]     id · title · space · last modified
// Credentials (never printed): ~/.claude.json .mcpServers.jira.env (ATLASSIAN_API_TOKEN + email), else the acli
// Confluence/Jira token in the macOS Keychain. Same Atlassian API token as Jira.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const H = os.homedir();
function creds() {
  for (const f of [process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"), path.join(H, ".claude.json")].filter(Boolean)) {
    try { const e = JSON.parse(fs.readFileSync(f, "utf8")).mcpServers?.jira?.env || {}; if (e.ATLASSIAN_API_TOKEN && (e.ATLASSIAN_USER_EMAIL || e.JIRA_USERNAME)) return { token: e.ATLASSIAN_API_TOKEN, email: e.ATLASSIAN_USER_EMAIL || e.JIRA_USERNAME }; } catch {}
  }
  for (const app of ["confluence", "jira"]) { try {
    const cfg = fs.readFileSync(path.join(H, `.config/acli/${app}_config.yaml`), "utf8"); const fld = (n) => new RegExp(`${n}:\\s*(\\S+)`).exec(cfg)?.[1];
    const raw = execFileSync("security", ["find-generic-password", "-s", "acli", "-a", `${app}:${fld("cloud_id")}:${fld("account_id")}`, "-w"], { encoding: "utf8" }).trim();
    return { token: raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice(18), "base64").toString("utf8") : raw, email: fld("email") }; } catch {} }
  return null;
}
const c = creds(); if (!c) { console.error("confluence-read: no Atlassian credentials (.mcpServers.jira.env in ~/.claude.json, or acli login)"); process.exit(1); }
const SITE = "https://aircall-product.atlassian.net/wiki", auth = "Basic " + Buffer.from(`${c.email}:${c.token}`).toString("base64");
const get = async (p) => { const r = await fetch(SITE + p, { headers: { Authorization: auth, Accept: "application/json" } }); const t = await r.text(); if (!r.ok) { console.error(`HTTP ${r.status}: ${t.slice(0, 200)}`); process.exit(1); } return JSON.parse(t); };
const text = (h) => h.replace(/<ac:structured-macro[^>]*ac:name="code"[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/ac:structured-macro>/g, "\n```\n$1\n```\n")
  .replace(/<\/(p|h[1-6]|li|div|blockquote)>/g, "\n").replace(/<h([1-6])[^>]*>/g, (m, n) => "\n" + "#".repeat(+n) + " ").replace(/<li[^>]*>/g, "- ")
  .replace(/<\/t[hd]>/g, " | ").replace(/<t[hd][^>]*>/g, "").replace(/<\/tr>/g, "\n").replace(/<tr[^>]*>/g, "| ").replace(/<br\s*\/?>/g, "\n")
  .replace(/<ac:link>[\s\S]*?ri:content-title="([^"]+)"[\s\S]*?<\/ac:link>/g, "[$1]").replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, "$2 ($1)")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const [cmd, arg, lim] = process.argv.slice(2);
if (cmd === "get" && arg) {
  const id = (String(arg).match(/pages\/(\d+)/) || [])[1] || (/^\d+$/.test(arg) ? arg : null); if (!id) { console.error("give a page id or a /pages/<id>/ URL"); process.exit(1); }
  const p = await get(`/rest/api/content/${id}?expand=body.storage,version,space`);
  console.log(`# ${p.title}\nspace ${p.space?.key} · version ${p.version?.number} · ${p.version?.when?.slice(0, 10)} · ${SITE}${p._links?.webui || ""}\n\n${text(p.body?.storage?.value || "")}`);
} else if (cmd === "search" && arg) {
  const r = await get(`/rest/api/content/search?limit=${Math.min(25, Number(lim) || 10)}&expand=space,version&cql=${encodeURIComponent(arg)}`);
  for (const p of r.results || []) console.log(`${p.id} · ${p.title} · ${p.space?.key} · ${p.version?.when?.slice(0, 10)}`);
} else { console.error("usage: confluence-read get <id|url> | search '<CQL>' [limit]"); process.exit(1); }
