#!/usr/bin/env bash
# cc-sweep [--dry-run] [--jira-done] [--quiet]: automatic cleanup after merges. For every worktree of this repo whose
# branch is merged (a merged MR from it, or merged into origin/main with commits of its own; see merged()), and that no running process is using, run
# cc-clean --yes. Never touches the worktree you are in, a dirty tree, or one with a live session. Called in the
# background by the `claude` wrapper on every start and by /ship prepare, so merged tickets disappear on their own.
# Log: ~/.claude/logs/sweep.log
set -uo pipefail
DRY=0; JIRA=""; QUIET=0; for a in "$@"; do case "$a" in --dry-run) DRY=1;; --jira-done) JIRA="--jira-done";; --quiet) QUIET=1;; esac; done
LOG="$HOME/.claude/logs/sweep.log"; mkdir -p "$(dirname "$LOG")"
say(){ [ "$QUIET" = 1 ] || echo "$*"; echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { cand="$(ls -d "$PWD"/*/.git 2>/dev/null | head -1)"; [ -n "$cand" ] && ROOT="$(dirname "$cand")"; }
[ -n "${ROOT:-}" ] || exit 0
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"; case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON";; esac
MAINROOT="$(cd "$(dirname "$COMMON")" && pwd)"
MAIN="$(git -C "$MAINROOT" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#origin/##')"; MAIN="${MAIN:-main}"
git -C "$MAINROOT" fetch --prune --quiet origin 2>/dev/null || exit 0
MERGED_SRC=""; command -v glab >/dev/null && MERGED_SRC="$(cd "$MAINROOT" && glab mr list --merged --author=@me --per-page 100 --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s||"[]"))console.log(m.source_branch)})' 2>/dev/null)"
OPEN_SRC=""; command -v glab >/dev/null && OPEN_SRC="$(cd "$MAINROOT" && glab mr list --author=@me --per-page 100 --output json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s||"[]"))console.log(m.source_branch)})' 2>/dev/null)"
HERE="$(pwd -P)"; n=0
# merged(b) — 0 if branch b is merged, 1 if not, 2 if it is a fresh branch with no work of its own.
# Merged means (a) a merged MR has it as source branch, or (b) its tip is an ancestor of origin/main reached only
# through a merge (not on main's first-parent line) and its reflog is not just "branch: Created from". A tip on the
# first-parent line is a main commit the branch was cut from (or a fast-forward merge, which (a) still catches).
merged(){
  local b="$1" tip
  echo "$OPEN_SRC" | grep -qx "$b" && return 1
  echo "$MERGED_SRC" | grep -qx "$b" && return 0
  git -C "$MAINROOT" merge-base --is-ancestor "refs/heads/$b" "origin/$MAIN" 2>/dev/null || return 1
  tip="$(git -C "$MAINROOT" rev-parse "refs/heads/$b")"
  git -C "$MAINROOT" rev-list --first-parent "origin/$MAIN" --not $(git -C "$MAINROOT" rev-parse "$tip^@") | grep -qx "$tip" && return 2
  [ "$(git -C "$MAINROOT" reflog show --format=%gs "refs/heads/$b" 2>/dev/null | grep -vc '^branch: Created from')" = 0 ] && return 2
  return 0
}
while read -r W B; do
  b=${B#refs/heads/}; [ -z "$b" ] || [ "$b" = "$MAIN" ] && continue
  t="$(echo "$b" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1)"; [ -n "$t" ] || continue
  case "$HERE/" in "$W"/*) continue;; esac                                     # the worktree we are in
  merged "$b"; case $? in 1) continue;; 2) say "• $t: branch $b has no commits yet — left alone"; continue;; esac
  [ -n "$(git -C "$W" status --porcelain 2>/dev/null)" ] && { say "• $t: merged but dirty tree at $W — left for you"; continue; }
  if command -v lsof >/dev/null && lsof -a -d cwd -Fn 2>/dev/null | grep -q "^n$W"; then say "• $t: merged, but a process (a claude session?) still lives in $W — left alone"; continue; fi
  if [ "$DRY" = 1 ]; then say "▸ would clean $t ($b · $W)"; continue; fi
  if (cd "$MAINROOT" && bash "$(dirname "$0")/cc-clean.sh" "$t" --yes $JIRA >>"$LOG" 2>&1); then say "✓ cleaned $t ($b)"; n=$((n+1)); else say "✗ cc-clean $t failed — see $LOG"; fi
done < <(git -C "$MAINROOT" worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{print w, $2}')
# merged local branches without a worktree
for b in $(git -C "$MAINROOT" for-each-ref --format='%(refname:short)' refs/heads/ | grep -E '[A-Z][A-Z0-9]+-[0-9]+'); do
  git -C "$MAINROOT" worktree list --porcelain | grep -q "^branch refs/heads/$b$" && continue
  merged "$b"; case $? in 1) continue;; 2) say "• branch $b has no commits yet — left alone"; continue;; esac
  [ "$DRY" = 1 ] && { say "▸ would delete merged local branch $b"; continue; }
  git -C "$MAINROOT" branch -D "$b" >/dev/null 2>&1 && say "✓ deleted merged local branch $b"
done
git -C "$MAINROOT" worktree prune 2>/dev/null
[ "$n" -gt 0 ] || [ "$QUIET" = 1 ] || echo "• nothing merged to clean"
