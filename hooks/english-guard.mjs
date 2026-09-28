#!/usr/bin/env node
// english-guard (PreToolUse Write|Edit|MultiEdit): everything written into the knowledge folder (~/.claude/knowledge,
// and the same path of any other profile) is English. Spanish text is sent back to be rewritten before it lands.
// Detection ignores code, URLs and capitalised names (Nora Cía stays fine): it looks for ¿ ¡ ñ, lowercase accented
// Spanish words (está, también…) and common Spanish function words. Test: echo "text" | node english-guard.mjs --check
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function spanish(raw) {
  const t = String(raw || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ").replace(/https?:\/\/\S+/g, " ");
  const hits = [];
  const marks = t.match(/[¿¡]|\b\p{Ll}*ñ\p{Ll}*\b/gu) || []; if (marks.length) hits.push(...marks.slice(0, 3));
  const accented = (t.match(/(?<![\p{L}])\p{Ll}*[áéíóú]\p{Ll}*/gu) || []); if (accented.length >= 2) hits.push(...accented.slice(0, 3));
  const words = (t.toLowerCase().match(/\b(que|para|los|las|una|con|por|del|pero|porque|cuando|como|esto|este|esta|hay|muy|también|sin|sobre|entre|desde|hasta|donde|nosotros|tiene|puede|hacer)\b/g) || []);
  if (words.length >= 4) hits.push(...[...new Set(words)].slice(0, 4));
  return hits.length ? [...new Set(hits)] : null;
}

const MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;   // imported by tools: only export spanish()
if (MAIN) main();
function main() {
if (process.argv.includes("--check")) { const h = spanish(fs.readFileSync(0, "utf8")); console.log(h ? `✗ looks Spanish: ${h.join(", ")}` : "✓ English"); process.exit(h ? 1 : 0); }
let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return; }
if (process.env.AIRCODE_SESSION_METADATA_PATH || /aircall-aircode-agents/.test(process.env.CLAUDE_CODE_AGENT || "")) return;
const ti = input.tool_input || {}, file = String(ti.file_path || "");
if (!/\/\.claude[^/]*\/knowledge\//.test(file)) return;
const text = [ti.content, ti.new_string, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join("\n");
const h = spanish(text); if (!h) return;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason: `english-guard: the knowledge folder is English only, and this text looks Spanish (${h.join(", ")}). Write it in English. A quote that must stay close to the original: translate it and mark it "(translated from Spanish)".` } }));
}
