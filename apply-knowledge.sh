#!/usr/bin/env bash
# Knowledge: English only (english-guard hook on Write|Edit|MultiEdit into ~/.claude/knowledge) and versioned in kaicode
# (knowledge-backup copies ~/.claude/knowledge/**/*.md into ~/.claude-work/knowledge at every /retro --close;
# people.json stays local). Also installs kai-install itself: from now on every update merges, never overwrites.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"; DST="$HOME/.claude"; F="$DST/settings.json"; NODE="$(command -v node)"
node "$SRC/tools/kai-install.mjs" tools/kai-install.mjs hooks/english-guard.mjs tools/knowledge-backup.mjs tools/retro-report.mjs tools/people.mjs agents/lead.md
cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)"
"$NODE" - "$F" "$NODE" "$DST" <<'JS'
const fs = require("fs"), [f, node, dst] = process.argv.slice(2), d = JSON.parse(fs.readFileSync(f, "utf8"));
d.hooks ??= {}; d.hooks.PreToolUse ??= [];
d.hooks.PreToolUse = d.hooks.PreToolUse.filter((g) => !JSON.stringify(g).includes("english-guard.mjs"));
d.hooks.PreToolUse.push({ matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: `${node} ${dst}/hooks/english-guard.mjs`, timeout: 5 }] });
fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n"); console.log("  ✓ english-guard registered on Write|Edit|MultiEdit (knowledge folder only)");
JS
node "$DST/tools/knowledge-backup.mjs"
echo "  first backup done: review with  cd ~/.claude-work && git status knowledge  and commit"
