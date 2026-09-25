#!/usr/bin/env bash
# cc-ticket <TICKET> [slug]: fetch origin, fast-forward main to origin/main, create (or reuse) a worktree
# ../<repo>.wt/<TICKET> on branch feat/<TICKET>[-slug] from origin/main, and print its path.
# Used by the claude wrapper:  claude @ticket APR-1234 [slug]   → runs claude inside that worktree.
set -euo pipefail
T="${1:-}"; SLUG="${2:-}"
[ -n "$T" ] || { echo "usage: cc-ticket <TICKET> [slug]" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  # not in a repo: accept the worktrees container (<repo>-worktrees or <repo>.wt) and use the sibling repo
  here="$(pwd)"; base="$(basename "$here")"; cand=""
  case "$base" in *-worktrees) cand="$(dirname "$here")/${base%-worktrees}";; *.wt) cand="$(dirname "$here")/${base%.wt}";; esac
  [ -n "$cand" ] && [ -d "$cand/.git" ] && ROOT="$cand"
}
[ -n "${ROOT:-}" ] || { echo "✗ not inside a git repo" >&2; exit 1; }
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"; MAINROOT="$(cd "$ROOT" && cd "$(dirname "$COMMON")" && pwd)"
[ "$COMMON" = ".git" ] || ROOT="$MAINROOT"       # called from inside a worktree → operate on the main tree
cd "$ROOT"
MAIN="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main)"; MAIN="${MAIN:-main}"
BRANCH="feat/$T${SLUG:+-$SLUG}"
# Worktree folder: reuse an existing "<repo>-worktrees" (or "<repo>.wt") convention next to the repo; default "<repo>.wt".
WTBASE="$(dirname "$ROOT")/$(basename "$ROOT")-worktrees"; [ -d "$WTBASE" ] || WTBASE="$(dirname "$ROOT")/$(basename "$ROOT").wt"
WT="$WTBASE/$T"

# Copy gitignored files listed in <root>/.worktreeinclude (gitignore-style globs, e.g. .env, .env.*) into a new worktree.
copy_worktreeinclude() { # $1 = repo root, $2 = worktree
  [ -f "$1/.worktreeinclude" ] || return 0
  local n=0
  while IFS= read -r pat; do
    [ -n "$pat" ] && [ "${pat:0:1}" != "#" ] || continue
    while IFS= read -r f; do
      [ -n "$f" ] && [ ! -e "$2/$f" ] || continue
      mkdir -p "$2/$(dirname "$f")" && cp -R "$1/$f" "$2/$f" && n=$((n+1))
    done < <(cd "$1" && git ls-files --others --ignored --exclude-standard -- "$pat" 2>/dev/null)
  done < "$1/.worktreeinclude"
  [ "$n" -gt 0 ] && echo "▸ copied $n file(s) from .worktreeinclude" >&2 || true
}

echo "▸ git fetch origin" >&2; git fetch --prune origin >&2
# Sync local main with origin/main. If main is checked out somewhere (this tree or another worktree), fast-forward
# it there; otherwise update the ref directly. Never rewrites: a real divergence stops here.
if git show-ref --verify --quiet "refs/heads/$MAIN"; then
  MAIN_WT="$(git worktree list --porcelain | awk -v b="refs/heads/$MAIN" '/^worktree /{w=$2} /^branch /{if($2==b){print w; exit}}')"
  if [ -n "$MAIN_WT" ]; then
    if [ -n "$(git -C "$MAIN_WT" status --porcelain --untracked-files=no)" ]; then echo "▸ $MAIN checked out at $MAIN_WT with local changes: left as is" >&2
    else git -C "$MAIN_WT" merge --ff-only "origin/$MAIN" >&2 || { echo "✗ $MAIN at $MAIN_WT has diverged from origin/$MAIN; fix it first" >&2; exit 1; }; fi
  else
    git fetch origin "$MAIN:$MAIN" >&2 || { echo "✗ local $MAIN has diverged from origin/$MAIN; fix it first" >&2; exit 1; }
  fi
fi
# Where is the ticket branch checked out already, if anywhere?
BR_WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '/^worktree /{w=$2} /^branch /{if($2==b){print w; exit}}')"
if [ -d "$WT" ]; then
  echo "▸ reusing worktree $WT ($(git -C "$WT" rev-parse --abbrev-ref HEAD))" >&2
elif [ -n "$BR_WT" ] && [ "$BR_WT" != "$ROOT" ]; then
  WT="$BR_WT"; echo "▸ $BRANCH is already checked out at $WT: using it" >&2; bash "$(dirname "$0")/cc-link.sh" "$WT"
elif [ -n "$BR_WT" ]; then
  # checked out in the main working tree: move it to its own worktree, leave the main tree on main
  if [ -n "$(git status --porcelain)" ]; then
    echo "✗ $BRANCH is checked out in the main tree ($ROOT) with uncommitted changes." >&2
    echo "  Commit or stash them, then run again: the branch will be moved to $WT and the main tree switched to $MAIN." >&2; exit 1; fi
  git checkout -q "$MAIN" 2>/dev/null || git checkout -q --detach
  mkdir -p "$(dirname "$WT")"; git worktree add "$WT" "$BRANCH" >&2
  NOW="$(git rev-parse --abbrev-ref HEAD)"; [ "$NOW" = "HEAD" ] && NOW="detached HEAD ($MAIN lives in its own worktree)"
  echo "▸ moved $BRANCH from the main tree to $WT (main tree now on $NOW)" >&2
else
  mkdir -p "$(dirname "$WT")"
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then git worktree add "$WT" "$BRANCH" >&2
  elif git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then git worktree add --track -b "$BRANCH" "$WT" "origin/$BRANCH" >&2
  else git worktree add -b "$BRANCH" "$WT" "origin/$MAIN" >&2; fi
  copy_worktreeinclude "$ROOT" "$WT"
  bash "$(dirname "$0")/cc-link.sh" "$WT"     # untracked shared folders (openspec/) as symlinks
  echo "▸ created worktree $WT on $BRANCH from origin/$MAIN" >&2
fi
echo "$WT"
