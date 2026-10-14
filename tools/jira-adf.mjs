#!/usr/bin/env node
// jira-adf <ticket.md> [--out issue.json]: turns the jira-ticket markdown draft into a Jira create payload with the
// description in ADF (Atlassian Document Format). Supported markdown, nothing else:
//   front matter (between --- lines): project, type, summary, parent, blocks, relates, blast_radius, labels, start, due
//   > Outcome: …              → success panel (first line of the body)
//   ### Heading               → heading level 3
//   - item / 1. item          → bullet / ordered list (one level; two-space indent = nested list)
//   **bold**, `code`, [text](url), APR-123 → strong, code, link, link to the ticket
//   blank line                → new paragraph
import fs from "node:fs";
const [src, ...rest] = process.argv.slice(2);
if (!src) { console.error("usage: jira-adf <ticket.md> [--out issue.json]"); process.exit(1); }
const raw = fs.readFileSync(src, "utf8");
const fm = {}; let body = raw;
const m = raw.match(/^---\n([\s\S]*?)\n---\n?/); if (m) { body = raw.slice(m[0].length); for (const l of m[1].split("\n")) { const i = l.indexOf(":"); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } }
const SITE = fm.site || "https://aircall-product.atlassian.net";

function inline(s) {
  const out = []; const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\b([A-Z][A-Z0-9]+-\d+)\b)/g; let last = 0, x;
  while ((x = re.exec(s))) {
    if (x.index > last) out.push({ type: "text", text: s.slice(last, x.index) });
    if (x[2]) out.push({ type: "text", text: x[2], marks: [{ type: "strong" }] });
    else if (x[3]) out.push({ type: "text", text: x[3], marks: [{ type: "code" }] });
    else if (x[4]) out.push({ type: "text", text: x[4], marks: [{ type: "link", attrs: { href: x[5] } }] });
    else if (x[6]) out.push({ type: "inlineCard", attrs: { url: `${SITE}/browse/${x[6]}` } });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out.filter((n) => n.type !== "text" || n.text.length);
}
const para = (s) => ({ type: "paragraph", content: inline(s) });
const content = []; const lines = body.split("\n"); let i = 0;
function list(indent) {
  const ordered = /^\s*\d+\.\s/.test(lines[i]); const node = { type: ordered ? "orderedList" : "bulletList", content: [] };
  while (i < lines.length) {
    const l = lines[i]; const mm = l.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/); if (!mm) break;
    const ind = mm[1].length; if (ind < indent) break;
    if (ind > indent) { node.content.at(-1)?.content.push(list(ind)); continue; }
    node.content.push({ type: "listItem", content: [para(mm[2])] }); i++;
  }
  return node;
}
while (i < lines.length) {
  const l = lines[i];
  if (!l.trim()) { i++; continue; }
  let h; if ((h = l.match(/^(#{1,6})\s+(.*)$/))) { content.push({ type: "heading", attrs: { level: h[1].length }, content: inline(h[2]) }); i++; continue; }
  if (/^>\s?/.test(l)) { const t = []; while (i < lines.length && /^>\s?/.test(lines[i])) t.push(lines[i++].replace(/^>\s?/, "")); content.push({ type: "panel", attrs: { panelType: "success" }, content: [para(t.join(" "))] }); continue; }
  if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) { content.push(list(l.match(/^\s*/)[0].length)); continue; }
  const t = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*(?:[-*]|\d+\.)\s)/.test(lines[i])) t.push(lines[i++].trim()); content.push(para(t.join(" ")));
}
const doc = { type: "doc", version: 1, content };
const keys = (s) => (s || "").split(/[,\s]+/).filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k));
const links = [...keys(fm.blocks).map((k) => ({ add: { type: { name: "Blocks" }, outwardIssue: { key: k } } })), ...keys(fm.relates).map((k) => ({ add: { type: { name: "Relates" }, outwardIssue: { key: k } } }))];
const BLAST = { S: "10695" }; // known option ids of customfield_10188 (Blast Radius); others: read a ticket with that value
const fields = { project: { key: fm.project || "APR" }, issuetype: { name: fm.type || "Task" }, summary: fm.summary, description: doc,
  ...(fm.parent ? { parent: { key: fm.parent } } : {}), ...(fm.labels ? { labels: fm.labels.split(/[,\s]+/).filter(Boolean) } : {}),
  ...(fm.blast_radius && BLAST[fm.blast_radius] ? { customfield_10188: { id: BLAST[fm.blast_radius] } } : {}),
  ...(/^\d{4}-\d{2}-\d{2}$/.test(fm.start || "") ? { customfield_10015: fm.start } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(fm.due || "") ? { duedate: fm.due } : {}) };
const issue = { fields, ...(links.length ? { update: { issuelinks: links } } : {}) };
if (!fm.summary) { console.error("jira-adf: summary missing in the front matter"); process.exit(1); }
const oi = rest.indexOf("--out"); const json = JSON.stringify(issue, null, 2);
if (oi >= 0) { fs.writeFileSync(rest[oi + 1], json + "\n"); console.log(`wrote ${rest[oi + 1]} (${content.length} blocks, ${links.length} links)`); } else console.log(json);
