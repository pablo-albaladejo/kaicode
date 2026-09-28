#!/usr/bin/env bash
# Voice: messages under the user's name read like him (B1 English, human, simple, direct, humble, no machine marks).
# Installs hooks/voice-lint.mjs as a PreToolUse hook on the Slack message tools and on Bash (only `glab mr note` is
# checked there). The guide itself is lead.md "Voice". Test any text: echo "…" | node ~/.claude/hooks/voice-lint.mjs --check
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"; DST="$HOME/.claude"; F="$DST/settings.json"
cp "$SRC/hooks/voice-lint.mjs" "$DST/hooks/voice-lint.mjs"; echo "  ✓ hooks/voice-lint.mjs"
cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)"
node - "$F" "$(command -v node)" "$DST" <<'JS'
const fs = require("fs"), [f, node, dst] = process.argv.slice(2), d = JSON.parse(fs.readFileSync(f, "utf8"));
d.hooks ??= {}; d.hooks.PreToolUse ??= [];
const cmd = `${node} ${dst}/hooks/voice-lint.mjs`;
d.hooks.PreToolUse = d.hooks.PreToolUse.filter((g) => !JSON.stringify(g).includes("voice-lint.mjs"));
d.hooks.PreToolUse.push({ matcher: "mcp__plugin_slack_slack__slack_(send_message|send_message_draft|schedule_message)|Bash", hooks: [{ type: "command", command: cmd, timeout: 5 }] });
fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n"); console.log("  ✓ PreToolUse hook registered (Slack message tools + glab mr note)");
JS
echo "  applies from the next tool call; lead.md Voice from the next session"
