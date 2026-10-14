#!/usr/bin/env bash
# jira-qa-done <TICKET> [--check]: set a ticket's QA Sub-Status (customfield_10193) to Done and wait for the Jira
# automation to move it to Ready For Production. No model involved; uses the Jira REST API v3.
#   --check  read-only: prints status, QA Sub-Status and the allowed transitions ("id name -> to").
#   (write)  refuses unless the status is "Assigned to QA"; PUTs QA Sub-Status = Done (option 10713), prints
#            "PUT HTTP <code>", then polls up to ~20s for the status change.
# The write form is a Jira write: bash-guard requires the user's confirmation (CC_CONFIRMED=1 prefix).
# Credentials: token and email from ~/.claude.json .mcpServers.jira.env (the jira MCP config). The token is passed to
# curl through a config on stdin (never argv, never printed); only API answers are printed.
# Exit code: 0 done (or --check) · 1 refused / PUT or API failed · 2 PUT ok but status did not move in time.
set -uo pipefail
KEY="${1:?usage: jira-qa-done <TICKET> [--check]}"; MODE="${2:-}"
[[ "$KEY" =~ ^[A-Z][A-Z0-9]+-[0-9]+$ ]] || { echo "jira-qa-done: invalid ticket key '$KEY'"; exit 1; }
[ -z "$MODE" ] || [ "$MODE" = "--check" ] || { echo "usage: jira-qa-done <TICKET> [--check]"; exit 1; }
SITE="https://aircall-product.atlassian.net"
FIELD="customfield_10193"; DONE_ID="10713"; TARGET="Ready For Production"; WAIT=20
CFG="$HOME/.claude.json"
TOKEN=$(jq -r '.mcpServers.jira.env.ATLASSIAN_API_TOKEN // empty' "$CFG" 2>/dev/null)
if [ -z "$TOKEN" ] && [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then   # profile sessions keep their own .claude.json
  CFG="$CLAUDE_CONFIG_DIR/.claude.json"; TOKEN=$(jq -r '.mcpServers.jira.env.ATLASSIAN_API_TOKEN // empty' "$CFG" 2>/dev/null)
fi
[ -n "$TOKEN" ] || { echo "jira-qa-done: no .mcpServers.jira.env.ATLASSIAN_API_TOKEN in $CFG (add it there; do not paste it in the chat)"; exit 1; }
EMAIL=$(jq -r '.mcpServers.jira.env.ATLASSIAN_USER_EMAIL // empty' "$CFG" 2>/dev/null)
[ -n "$EMAIL" ] || EMAIL=$(acli jira auth status 2>/dev/null | sed -n 's/^ *Email: *//p' | head -1)
[ -n "$EMAIL" ] || EMAIL="pablo.albaladejo@aircall.io"   # fallback: the account that owns the token

# api METHOD PATH [JSON] → body on stdout, HTTP code in $CODE_FILE. Auth goes through `curl -K -` (stdin).
CODE_FILE=$(mktemp); trap 'rm -f "$CODE_FILE"' EXIT
api() {
  local method="$1" p="$2" out; local -a extra=()
  [ -n "${3:-}" ] && extra=(-H "Content-Type: application/json" --data "$3")
  out=$(printf 'user = "%s:%s"\n' "$EMAIL" "$TOKEN" | curl -sS -K - -X "$method" -H "Accept: application/json" \
    "${extra[@]+"${extra[@]}"}" -w '\n%{http_code}' "$SITE$p" 2>&1)
  echo "${out##*$'\n'}" > "$CODE_FILE"; printf '%s' "${out%$'\n'*}"
}
code() { cat "$CODE_FILE"; }

state() { # prints "status<TAB>qa-sub-status"; fails on API error
  local b; b=$(api GET "/rest/api/3/issue/$KEY?fields=status,$FIELD")
  [ "$(code)" = "200" ] || { echo "jira-qa-done: GET issue $KEY → HTTP $(code): $(echo "$b" | head -c 300)" >&2; return 1; }
  echo "$b" | jq -r --arg f "$FIELD" '[.fields.status.name, (.fields[$f].value // "(none)")] | @tsv'
}
transitions() {
  local b; b=$(api GET "/rest/api/3/issue/$KEY/transitions")
  [ "$(code)" = "200" ] || { echo "  (GET transitions → HTTP $(code))"; return; }
  echo "$b" | jq -r '.transitions[] | "  \(.id) \(.name) -> \(.to.name)"'
}

S=$(state) || exit 1
STATUS="${S%%$'\t'*}"; QA="${S#*$'\t'}"
echo "$KEY status: $STATUS"
echo "$KEY QA Sub-Status ($FIELD): $QA"
if [ "$MODE" = "--check" ]; then echo "Transitions:"; transitions; exit 0; fi

if [ "$STATUS" != "Assigned to QA" ]; then
  echo "Refused: $KEY must be in \"Assigned to QA\" to set QA Sub-Status to Done (it is \"$STATUS\"). Transitions from here:"
  transitions; exit 1
fi
B=$(api PUT "/rest/api/3/issue/$KEY" "{\"fields\":{\"$FIELD\":{\"id\":\"$DONE_ID\"}}}")
echo "PUT HTTP $(code)"
[ "$(code)" = "204" ] || { [ -n "$B" ] && echo "$B" | head -c 500; echo; exit 1; }

deadline=$(( $(date +%s) + WAIT ))
while :; do
  S=$(state) || exit 1; STATUS="${S%%$'\t'*}"
  [ "$STATUS" = "$TARGET" ] && { echo "Final status: $STATUS (QA Sub-Status: ${S#*$'\t'})"; exit 0; }
  [ $(date +%s) -ge $deadline ] && { echo "Final status: $STATUS (QA Sub-Status: ${S#*$'\t'}); automation did not reach \"$TARGET\" within ${WAIT}s"; exit 2; }
  sleep 3
done
