#!/usr/bin/env bash
# cc-clean <TICKET> [--jira-done] [--yes]: tidy up after a merge. Run it from your shell (any folder of the repo or
# its worktrees container), never from inside the session that owns the worktree — a session cannot remove itself.
#   1. finds the worktree and branch of the ticket, checks the MR is merged (glab) or the branch content is in origin/main
#   2. archives .claude/ship/<T>/ to ~/.claude/logs/ship-archive/<T>-<date>/ (state, brief, plan — the retro reads them)
#   3. git worktree remove · git branch -D (safe: content verified in main) · remote branch delete if still there
#   4. --jira-done: comment "merged in <sha>" + transition to Done (asks unless --yes)
# Refuses when the tree is dirty, the branch has commits that are not in main, or the MR is not merged.
set -uo pipefail
T="${1:?usage: cc-clean <TICKET> [--jira-done] [--yes]}"; shift || true
JIRA=0; YES=0; for a in "$@"; do case "$a" in --jira-done) JIRA=1;; --yes) YES=1;; esac; done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { cand="$(ls -d "$PWD"/*/.git 2>/dev/null | head -1)"; [ -n "$cand" ] && ROOT="$(dirname "$cand")"; }
[ -n "${ROOT:-}" ] || { echo "✗ run inside the repo or its worktrees container"; exit 2; }
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"; case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON";; esac
MAINROOT="$(cd "$(dirname "$COMMON")" && pwd)"
MAIN="$(git -C "$MAINROOT" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#origin/##')"; MAIN="${MAIN:-main}"
git -C "$MAINROOT" fetch --prune --quiet origin
# worktree + branch of the ticket
WT="$(git -C "$MAINROOT" worktree list --porcelain | awk -v t="$T" '/^worktree /{w=$2} /^branch /{if(index($2,t)>0){print w; exit}}')"
BR="$(git -C "$MAINROOT" worktree list --porcelain | awk -v t="$T" '/^branch /{if(index($2,t)>0){sub("refs/heads/","",$2);print $2; exit}}')"
[ -z "$BR" ] && BR="$(git -C "$MAINROOT" branch --list "*$T*" | sed 's/^[* +]*//' | head -1)"
[ -n "$BR" ] || { echo "✗ no branch for $T"; exit 1; }
[ "$PWD" = "$WT" ] && { echo "✗ you are inside $WT — cd elsewhere first"; exit 1; }
echo "▸ $T: branch $BR${WT:+ · worktree $WT}"
if [ -n "$WT" ] && [ -n "$(git -C "$WT" status --porcelain)" ]; then echo "✗ $WT has uncommitted changes — commit, stash or discard first"; exit 1; fi
# merged? MR state first, then content (squash merges are not ancestors)
MERGED=0; MR=""; SHA="$(git -C "$MAINROOT" rev-parse "$BR")"
if command -v glab >/dev/null; then MR="$(cd "$MAINROOT" && glab mr list --merged --source-branch "$BR" --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s||"[]")[0];if(m)console.log("!"+m.iid+" "+m.merge_commit_sha)})' 2>/dev/null)"; [ -n "$MR" ] && MERGED=1; fi
if git -C "$MAINROOT" merge-base --is-ancestor "$SHA" "origin/$MAIN"; then MERGED=1; fi
if [ "$MERGED" = 0 ] && [ -z "$(git -C "$MAINROOT" diff --stat "origin/$MAIN" "$SHA" -- $(git -C "$MAINROOT" diff --name-only "origin/$MAIN...$SHA" 2>/dev/null) 2>/dev/null)" ]; then MERGED=1; fi
[ "$MERGED" = 1 ] || { echo "✗ $BR is not merged (no merged MR from it, not an ancestor of origin/$MAIN, and its files differ from main) — nothing removed"; exit 1; }
echo "✓ merged${MR:+ (MR $MR)}"
# Learn happened? The close + learn stage writes the ticket's lessons to ~/.claude/knowledge; if the loop never got there
# (merged by hand while it was still in feedback), cleaning now would throw them away — run it first, it takes a minute.
if [ -n "$WT" ] && [ -f "$WT/.claude/ship/$T/state.json" ] && [ "$YES" = 0 ]; then
  STG="$(node -e 'console.log(require(process.argv[1]).stage||"")' "$WT/.claude/ship/$T/state.json" 2>/dev/null)"
  case "$STG" in close|ready-for-merge) ;; *) echo "✗ /ship state is at '$STG': the close + learn stage has not run. In the ticket session: '/ship $T' (it sees the merge, records the lessons, reaches ready-for-merge), then cc-clean. --yes skips this check."; exit 1;; esac
fi
# archive ship state
if [ -n "$WT" ] && [ -d "$WT/.claude/ship/$T" ]; then A="$HOME/.claude/logs/ship-archive/$T-$(date +%Y%m%d)"; mkdir -p "$A"; cp -R "$WT/.claude/ship/$T/." "$A/"; echo "▸ ship state archived to $A"
  node -e 'const s=require(process.argv[1]);if(!(s.lessons||[]).length)console.log("  • no lessons recorded for this ticket — the Learn step did not run; add them to ~/.claude/knowledge by hand if any")' "$A/state.json" 2>/dev/null
  [ -f "$HOME/.claude/logs/ship-stages.jsonl" ] && echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ticket\":\"$T\",\"repo\":\"$(basename "$MAINROOT")\",\"stage\":\"merged\",\"to\":\"cleaned\",\"seconds\":null,\"attempts\":null}" >> "$HOME/.claude/logs/ship-stages.jsonl"; fi
# remove
[ -n "$WT" ] && { git -C "$MAINROOT" worktree remove "$WT" && echo "▸ worktree removed"; }
git -C "$MAINROOT" branch -D "$BR" >/dev/null && echo "▸ local branch $BR deleted"
if git -C "$MAINROOT" show-ref --verify --quiet "refs/remotes/origin/$BR"; then
  if [ "$YES" = 1 ] || { read -r -p "  delete remote branch origin/$BR? [y/N] " a; [ "$a" = y ]; }; then git -C "$MAINROOT" push origin --delete "$BR" && echo "▸ remote branch deleted"; fi
fi
git -C "$MAINROOT" worktree prune
# jira
if [ "$JIRA" = 1 ] && command -v acli >/dev/null; then
  MSHA="$(git -C "$MAINROOT" log --oneline "origin/$MAIN" --grep="$T" -1 | cut -c1-8)"
  if [ "$YES" = 1 ] || { read -r -p "  comment + transition $T to Done? [y/N] " a; [ "$a" = y ]; }; then
    acli jira workitem comment create --key "$T" --body "Merged into $MAIN in $MSHA${MR:+ (MR $MR)}." >/dev/null && echo "▸ Jira comment added"
    acli jira workitem transition --key "$T" --status "Done" >/dev/null && echo "▸ Jira → Done"; fi
fi
echo "✓ $T cleaned"
