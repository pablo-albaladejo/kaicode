#!/usr/bin/env bash
# mr-checkout <MR URL | !123 | 123>: make sure the MR's repo is available locally and print "<dir> <iid>".
#   URL  → find the clone under $CC_REPOS_DIR (default ~/development) by its origin; clone it there if missing;
#          fetch the MR source branch into a worktree <repo>.wt/mr-<iid> so the review runs on the MR's code.
#   !123 → the repo of the current folder; prints "<current toplevel> 123".
# After this, review and posting work exactly like inside the repo:  cd <dir> && glab mr view <iid> …
set -euo pipefail
T="${1:-}"; [ -n "$T" ] || { echo "usage: mr-checkout <MR URL | !iid | iid>" >&2; exit 1; }
ROOT_DIR="${CC_REPOS_DIR:-$HOME/development}"

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

if [[ "$T" =~ ^https?://([^/]+)/(.+)/-/merge_requests/([0-9]+) ]]; then
  HOST="${BASH_REMATCH[1]}"; PROJ="${BASH_REMATCH[2]}"; IID="${BASH_REMATCH[3]}"; NAME="$(basename "$PROJ")"
  export GITLAB_HOST="${GITLAB_HOST:-$HOST}"
  # 1. existing clone: origin matching <group>/<project> (main working trees only), quickest candidates first
  DIR=""
  for c in "$ROOT_DIR/$NAME" $(find "$ROOT_DIR" -maxdepth 3 -type d -name .git -not -path '*/.wt/*' 2>/dev/null | sed 's|/\.git$||'); do
    [ -d "$c/.git" ] || continue
    if git -C "$c" config --get remote.origin.url 2>/dev/null | grep -qiE "[:/]$PROJ(\.git)?$"; then DIR="$c"; break; fi
  done
  # 2. clone if missing
  if [ -z "$DIR" ]; then
    DIR="$ROOT_DIR/$NAME"; echo "▸ cloning $PROJ → $DIR" >&2
    mkdir -p "$ROOT_DIR"; glab repo clone "$PROJ" "$DIR" >&2
  fi
  # 3. MR source branch in its own worktree (never touches whatever is checked out in $DIR)
  SRC="$(cd "$DIR" && glab mr view "$IID" --output json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).source_branch))')"
  WTBASE="$(dirname "$DIR")/$(basename "$DIR")-worktrees"; [ -d "$WTBASE" ] || WTBASE="$(dirname "$DIR")/$(basename "$DIR").wt"
  WT="$WTBASE/mr-$IID"
  git -C "$DIR" fetch --prune origin "$SRC" >&2
  if [ -d "$WT" ]; then git -C "$WT" checkout -q --detach "origin/$SRC" >&2
  else mkdir -p "$(dirname "$WT")"; git -C "$DIR" worktree add --detach "$WT" "origin/$SRC" >&2; fi
  copy_worktreeinclude "$DIR" "$WT"
  echo "▸ $PROJ !$IID ($SRC) → $WT" >&2
  echo "$WT $IID"
else
  IID="${T#!}"; [[ "$IID" =~ ^[0-9]+$ ]] || { echo "✗ not an MR URL or number: $T" >&2; exit 1; }
  DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ not inside a git repo; pass the MR URL" >&2; exit 1; }
  echo "$DIR $IID"
fi
