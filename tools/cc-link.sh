#!/usr/bin/env bash
# cc-link [worktree]: make untracked-but-shared folders of the main tree visible in a worktree as symlinks.
# Default list: openspec (one source of truth for specs, never copied). Add more, one per line, in <root>/.worktreelink.
# The link names are added to .git/info/exclude (shared by all worktrees) so `git status` stays clean and `git add -A`
# never commits them. Idempotent. Called by cc-ticket on worktree creation and by /ship prepare.
set -uo pipefail
WT="${1:-$PWD}"; cd "$WT" || exit 2
COMMON="$(git rev-parse --git-common-dir 2>/dev/null)" || { echo "✗ not a git repo" >&2; exit 2; }
case "$COMMON" in /*) ;; *) COMMON="$PWD/$COMMON";; esac
ROOT="$(cd "$(dirname "$COMMON")" && pwd)"
WTROOT="$(git rev-parse --show-toplevel)"
[ "$ROOT" = "$WTROOT" ] && exit 0   # main tree: nothing to link
LIST="openspec"; [ -f "$ROOT/.worktreelink" ] && LIST="$(grep -v '^#' "$ROOT/.worktreelink" | tr '\n' ' ') openspec"
n=0
for d in $LIST; do
  [ -e "$ROOT/$d" ] || continue
  git -C "$ROOT" ls-files --error-unmatch "$d" >/dev/null 2>&1 && continue    # tracked: the checkout already has it
  if [ -L "$WTROOT/$d" ]; then continue
  elif [ -e "$WTROOT/$d" ]; then echo "• $d exists in the worktree as a real path — not replacing it (merge by hand if it diverged from $ROOT/$d)" >&2; continue; fi
  ln -s "$ROOT/$d" "$WTROOT/$d" && n=$((n+1))
  grep -qx "/$d" "$COMMON/info/exclude" 2>/dev/null || echo "/$d" >> "$COMMON/info/exclude"
  echo "▸ linked $d → $ROOT/$d (excluded from git status in every worktree)" >&2
done
[ "$n" -gt 0 ] || echo "• shared folders already linked" >&2
