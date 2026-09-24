#!/usr/bin/env bash
# Prints the ticket-worktrees folder of the current repo (<repo>-worktrees or <repo>.wt next to the main tree), creating
# it if missing. Works from the main tree or from any of its worktrees. Silent (exit 1) outside a git repo.
# Used by the claude wrapper: --add-dir "$(cc-wtbase)" so a session can cd between sibling ticket worktrees.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  # not in a repo: accept the worktrees container (<repo>-worktrees or <repo>.wt) and use the sibling repo
  here="$(pwd)"; base="$(basename "$here")"; cand=""
  case "$base" in *-worktrees) cand="$(dirname "$here")/${base%-worktrees}";; *.wt) cand="$(dirname "$here")/${base%.wt}";; esac
  [ -n "$cand" ] && [ -d "$cand/.git" ] && ROOT="$cand"
}
[ -n "${ROOT:-}" ] || exit 1
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"; [ "$COMMON" = ".git" ] || ROOT="$(cd "$ROOT" && cd "$(dirname "$COMMON")" && pwd)"
B="$(dirname "$ROOT")/$(basename "$ROOT")-worktrees"; [ -d "$B" ] || { [ -d "$(dirname "$ROOT")/$(basename "$ROOT").wt" ] && B="$(dirname "$ROOT")/$(basename "$ROOT").wt"; }
mkdir -p "$B" && echo "$B"
