#!/usr/bin/env bash
# Installs: `claude @ticket <TICKET>` (worktree from origin/main) and the guard-branch hook (no edits on main /
# outside a worktree). Safe to re-run. Usage: bash ~/.claude-work/apply-worktree-guard.sh && source ~/.zshrc
set -euo pipefail
SRC="$HOME/.claude-work"; DST="$HOME/.claude"; ZSHRC="$HOME/.zshrc"; TS=$(date +%Y%m%d-%H%M%S)
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "✗ node not found"; exit 1; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }

mkdir -p "$DST/hooks" "$DST/tools"
cp "$SRC/hooks/guard-branch.mjs" "$DST/hooks/guard-branch.mjs";  ok "hooks/guard-branch.mjs"
cp "$SRC/tools/cc-ticket.sh" "$DST/tools/cc-ticket.sh"; chmod +x "$DST/tools/cc-ticket.sh"; ok "tools/cc-ticket.sh"

# settings.json: register the guard on file-editing tools (idempotent)
cp "$DST/settings.json" "$DST/settings.json.bak-$TS"
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],node=process.argv[2],home=process.env.HOME;
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.hooks??={}; d.hooks.PreToolUse??=[];
if(!JSON.stringify(d.hooks.PreToolUse).includes("guard-branch.mjs"))
  d.hooks.PreToolUse.push({matcher:"Edit|Write|MultiEdit|NotebookEdit",hooks:[{type:"command",command:`${node} ${home}/.claude/hooks/guard-branch.mjs`,timeout:5}]});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
console.log("  \u001b[32m✓\u001b[0m guard-branch registered on Edit|Write|MultiEdit|NotebookEdit (backup settings.json.bak-"+process.argv[3]+")");' "$DST/settings.json" "$NODE" "$TS"

# ~/.zshrc: add @ticket handling inside the claude() wrapper (between the markers)
cp "$ZSHRC" "$ZSHRC.bak-$TS"
SNIP="$(mktemp)"; cat > "$SNIP" <<'EOS'
    if [ "$1" = "@ticket" ]; then
      local wt slug=""; if [ -n "${3:-}" ] && [ "${3:0:1}" != "@" ] && [ "${3:0:1}" != "-" ]; then slug="$3"; fi
      wt="$(bash ~/.claude/tools/cc-ticket.sh "$2" "$slug")" || return 1
      shift 2; [ -n "$slug" ] && shift
      cd "$wt" && echo "→ $wt ($(git rev-parse --abbrev-ref HEAD))"
    fi
EOS
"$NODE" -e '
const fs=require("fs"),p=process.argv[1],snip=fs.readFileSync(process.argv[2],"utf8");let s=fs.readFileSync(p,"utf8");
if(!s.includes("# >>> claude-gateway >>>")){console.log("  ! claude() wrapper not found in ~/.zshrc — run install-gateway-models.sh first");process.exit(1);}
if(s.includes("@ticket")){console.log("  \u001b[32m✓\u001b[0m claude @ticket already present");process.exit(0);}
const anchor="\n    if [ \"${1:0:1}\" = \"@\" ]; then\n";
if(!s.includes(anchor)){console.log("  ! could not find the model-picker line in claude(); wrapper too old");process.exit(1);}
s=s.replace(anchor,"\n"+snip+anchor.slice(1));
s=s.replace("#   claude @gpt-6-sol any gateway model id","#   claude @ticket APR-1234 [slug]   worktree ../<repo>.wt/APR-1234 on feat/APR-1234 from origin/main, then claude there\n#   claude @gpt-6-sol any gateway model id");
fs.writeFileSync(p,s); console.log("  \u001b[32m✓\u001b[0m claude @ticket added to the wrapper (backup .zshrc.bak-"+process.argv[3]+")");' "$ZSHRC" "$SNIP" "$TS"
rm -f "$SNIP"
echo; echo "  Now:  source ~/.zshrc   then in a repo:  claude @ticket APR-1234 live-company-context"
echo "  Escape hatch for one session:  GUARD_BRANCH=off claude"
