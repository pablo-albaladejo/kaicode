#!/usr/bin/env bash
# SubagentStop: registra qué subagente termina, para ver quién consume el presupuesto.
# Log: <config dir>/logs/subagents.jsonl
dir="$(cd "$(dirname "$0")/.." && pwd)/logs"
mkdir -p "$dir"
input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$input" | jq -c '{ts: (now|todate), event: .hook_event_name, agent_type, agent_id, session_id, cwd}' >> "$dir/subagents.jsonl" 2>/dev/null
else
  printf '%s\n' "$(printf '%s' "$input" | tr -d '\n')" >> "$dir/subagents.jsonl"
fi
exit 0
