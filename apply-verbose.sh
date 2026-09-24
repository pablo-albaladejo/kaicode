#!/usr/bin/env bash
# Verbose output by default: inside a subagent view Claude Code shows each tool call with its output instead of
# "read 7 files, ran 6 shell commands". Same as /config → Verbose output; stored in ~/.claude.json ("verbose").
# Usage: bash ~/.claude-work/apply-verbose.sh [off]
set -euo pipefail
V=true; [ "${1:-}" = "off" ] && V=false
node -e '
const fs=require("fs"),p=process.env.HOME+"/.claude.json"; let j={}; try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
j.verbose=process.argv[1]==="true"; fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m ~/.claude.json verbose:",j.verbose,"(new sessions; ctrl+o toggles the current one)")' "$V"
