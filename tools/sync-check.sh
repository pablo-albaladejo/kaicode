#!/usr/bin/env bash
# sync-check [--fix] [--all]: are we in sync with the remote? Branch vs origin/main, branch vs its upstream, and (with
# --all) every worktree and open MR of this repo. Exit 0 = the current branch is rebased on origin/main and not
# diverged from its upstream; exit 1 = needs a rebase or a push/pull; exit 2 = not a git repo / no origin.
#   bash ~/.claude/tools/sync-check.sh          # current worktree
#   bash ~/.claude/tools/sync-check.sh --fix    # also rebase on origin/main when behind (clean tree only, never main)
#   bash ~/.claude/tools/sync-check.sh --all    # + worktrees with a gone/merged branch, open MRs behind main
set -uo pipefail
FIX=0; ALL=0; for a in "$@"; do case "$a" in --fix) FIX=1;; --all) ALL=1;; esac; done
git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "✗ not a git repo"; exit 2; }
git remote get-url origin >/dev/null 2>&1 || { echo "✗ no origin"; exit 2; }
git fetch --prune --quiet origin || { echo "✗ fetch failed (network?)"; exit 2; }
BR=$(git rev-parse --abbrev-ref HEAD); MAIN=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#origin/##'); MAIN="${MAIN:-main}"
rc=0
WTNAME="$(basename "$(git rev-parse --show-toplevel)")"; WTT="$(echo "$WTNAME" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1)"; BRT="$(echo "$BR" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1)"
[ -n "$WTT" ] && [ -n "$BRT" ] && [ "$WTT" != "$BRT" ] && { echo "✗ worktree $WTNAME has branch $BR ($BRT) — one ticket = one worktree; run claude @ticket $BRT for that ticket and put $WTT back on its own branch"; rc=1; }
if [ "$BR" = "HEAD" ]; then echo "• detached HEAD at $(git rev-parse --short HEAD)"; else
  BEHIND=$(git rev-list --count "HEAD..origin/$MAIN" 2>/dev/null || echo 0); AHEAD=$(git rev-list --count "origin/$MAIN..HEAD" 2>/dev/null || echo 0)
  if [ "$BEHIND" -gt 0 ]; then
    if [ "$FIX" = 1 ] && [ "$BR" != "$MAIN" ] && [ -z "$(git status --porcelain)" ]; then
      if git rebase --quiet "origin/$MAIN"; then echo "✓ $BR rebased on origin/$MAIN (+$AHEAD, was $BEHIND behind) — push with --force-with-lease if it was already pushed"; else git rebase --abort; echo "✗ $BR: rebase on origin/$MAIN has conflicts — resolve by hand"; rc=1; fi
    else echo "✗ $BR is $BEHIND commit(s) behind origin/$MAIN (+$AHEAD ahead) — rebase before review/push${FIX:+ (dirty tree or main: not auto-fixed)}"; rc=1; fi
  else echo "✓ $BR is rebased on origin/$MAIN (+$AHEAD ahead)"; fi
  if UP=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) && [ "$UP" != "origin/$MAIN" -o "$BR" = "$MAIN" ]; then
    A=$(git rev-list --count "$UP..HEAD"); B=$(git rev-list --count "HEAD..$UP")
    if [ "$A" -gt 0 ] && [ "$B" -gt 0 ]; then echo "✗ $BR diverged from $UP (+$A local, +$B remote) — someone pushed to this branch; git pull --rebase first"; rc=1
    elif [ "$B" -gt 0 ]; then echo "✗ $BR is $B behind $UP — git pull --rebase"; rc=1
    elif [ "$A" -gt 0 ]; then echo "• $BR has $A unpushed commit(s)"; fi
  elif [ "$BR" != "$MAIN" ]; then
    if git config "branch.$BR.merge" >/dev/null 2>&1; then echo "• $BR: its remote branch is gone (deleted on merge?) — if the MR is merged: bash ~/.claude/tools/cc-clean.sh <TICKET>"; else echo "• $BR has no upstream yet (never pushed)"; fi; fi
fi
[ -n "$(git status --porcelain)" ] && echo "• uncommitted changes in the tree"
if [ "$ALL" = 1 ]; then
  echo "— worktrees"
  MERGED_SRC=""; command -v glab >/dev/null && MERGED_SRC="$(glab mr list --merged --author=@me --per-page 100 --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s||"[]"))console.log(m.source_branch)})' 2>/dev/null)"
  git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{print w, $2}' | while read -r W B; do
    b=${B#refs/heads/}; [ "$b" = "$MAIN" ] && continue
    t="$(echo "$b" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1)"
    if git merge-base --is-ancestor "refs/heads/$b" "origin/$MAIN" 2>/dev/null || echo "$MERGED_SRC" | grep -qx "$b"; then st="MERGED — bash ~/.claude/tools/cc-clean.sh ${t:-<TICKET>}"
    elif ! git show-ref --verify --quiet "refs/remotes/origin/$b"; then st="not pushed (or remote branch gone) · $(git rev-list --count "origin/$MAIN..refs/heads/$b") local commit(s)"
    else st="open · behind main: $(git rev-list --count "refs/heads/$b..origin/$MAIN")"; fi
    echo "  $b  ($W)  $st"; done
  if command -v glab >/dev/null; then echo "— my open MRs"
    glab mr list --author=@me --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s||"[]"))console.log(`  !${m.iid} ${m.source_branch}${m.draft?" (draft)":""} — ${m.title.slice(0,60)}`)})' 2>/dev/null
    for b in $(glab mr list --author=@me --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s||"[]"))console.log(m.source_branch)})' 2>/dev/null); do
      git show-ref --verify --quiet "refs/remotes/origin/$b" || continue; n=$(git rev-list --count "origin/$b..origin/$MAIN"); [ "$n" -gt 0 ] && echo "  ✗ $b is $n behind origin/$MAIN — rebase before it can be approved"; done
  fi
fi
exit $rc
