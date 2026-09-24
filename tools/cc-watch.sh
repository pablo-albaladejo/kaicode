#!/usr/bin/env bash
# cc-watch [dir] [claude args…]: one tmux window = the claude session (left) + a pane per live subagent (right, cc-tail
# --panes) + the /ship status line (bottom right, refreshed). Used by `claude @watch [@ticket T]`.
set -uo pipefail
command -v tmux >/dev/null || { echo "✗ tmux not installed (brew install tmux)" >&2; exit 1; }
DIR="${1:-$PWD}"; shift || true
NAME="cc-$(basename "$DIR" | tr -c 'A-Za-z0-9' '-' | sed 's/-*$//')"
if tmux has-session -t "$NAME" 2>/dev/null; then exec tmux attach -t "$NAME"; fi
# zsh -ic so the claude() wrapper (gateway env, @ticket, router) is what runs inside the pane
ARGS="$*"; tmux new-session -d -s "$NAME" -c "$DIR" -x 220 -y 50 "zsh -ic 'claude $ARGS'"
tmux split-window -h -p 42 -t "$NAME" -c "$DIR" "node ~/.claude/tools/cc-tail.mjs --panes --since 5"
tmux split-window -v -p 12 -t "$NAME" -c "$DIR" "watch -t -n 10 'node ~/.claude/tools/ship-state.mjs status 2>/dev/null || echo no /ship state here'"
tmux select-pane -t "$NAME:0.0"
tmux set-option -t "$NAME" pane-border-status top >/dev/null 2>&1
tmux set-option -g focus-events on >/dev/null 2>&1   # Claude Code asks for it (prompt/HUD refresh on focus)
tmux set-option -t "$NAME" mouse on >/dev/null 2>&1     # wheel scrolls a pane's history instead of sending arrow keys into it
exec tmux attach -t "$NAME"
