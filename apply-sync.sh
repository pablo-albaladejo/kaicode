#!/usr/bin/env bash
# "In sync with the remote, always": sync-check tool, sync gate in ship-gates (push / mr create refused when the branch is
# behind origin/main or the fetch is stale), --force-with-lease on a feature branch allowed (bash-guard + settings deny),
# rebase steps in /ship (prepare, review-code, review-mr, feedback, close) and /review-mr 0c, lead rule.
# Usage: bash ~/.claude-work/apply-sync.sh
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; NODE="$(command -v node)"; ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
cp "$SRC/tools/sync-check.sh" "$DST/tools/sync-check.sh"; chmod +x "$DST/tools/sync-check.sh"; ok "tools/sync-check.sh [--fix] [--all]"
cp "$SRC/hooks/ship-gates.mjs" "$DST/hooks/ship-gates.mjs";  ok "hooks/ship-gates.mjs (sync gate on push / mr create)"
cp "$SRC/hooks/bash-guard.mjs" "$DST/hooks/bash-guard.mjs";  ok "hooks/bash-guard.mjs (--force-with-lease on a feature branch = write)"
cp "$SRC/commands/ship.md" "$DST/commands/ship.md"; cp "$SRC/commands/review-mr.md" "$DST/commands/review-mr.md"; ok "commands: ship.md (rebase before review/push/close) · review-mr.md (0c rebased?)"
cp "$SRC/agents/lead.md" "$DST/agents/lead.md"; ok "agents/lead.md (in sync with the remote, always)"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1]; const d=JSON.parse(fs.readFileSync(p,"utf8")); const P=d.permissions||(d.permissions={}); let deny=P.deny||[];
const before=deny.length; deny=deny.filter(e=>!/^Bash\(git push (--force|-f)\*?\)$/.test(e)&&e!=="Bash(git push --force*)"&&e!=="Bash(git push -f*)");
for (const e of ["Bash(git push --force)","Bash(git push --force *)","Bash(git push -f)","Bash(git push -f *)"]) if(!deny.includes(e)) deny.push(e);
P.deny=deny; fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); console.log("  \u001b[32m✓\u001b[0m settings.json deny: bare --force / -f only ("+before+" → "+deny.length+"); --force-with-lease no longer matched — restart claude to reload permissions");' "$DST/settings.json"
"$NODE" "$DST/tools/gen-effort-variants.mjs" --clean >/dev/null; "$NODE" "$DST/tools/gen-effort-variants.mjs" | tail -1 | sed 's/^/  ✓ /'
rm -f "$DST"/agents/task--*.md "$DST"/agents/lead--*.md "$DST"/agents/solo--*.md
echo; echo "  Try:  bash ~/.claude/tools/sync-check.sh --all     (inside a worktree)"
