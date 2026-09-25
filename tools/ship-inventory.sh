#!/usr/bin/env bash
# ship-inventory <TICKET>: what already exists for a ticket, before /ship decides where to start. Read-only.
# Prints JSON: branches (local/remote, ahead/behind origin/main, last commit), worktree (path, dirty), MRs (open/closed/
# merged, by source branch or title/description mention), openspec change, existing /ship state, Jira status (if acli).
# Usage: bash ~/.claude/tools/ship-inventory.sh APR-1234 [--human]
set -uo pipefail
T="${1:-}"; [ -n "$T" ] || { echo "usage: ship-inventory <TICKET> [--human]" >&2; exit 1; }
HUMAN="${2:-}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo '{"error":"not in a git repo"}'; exit 1; }
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"; [ "$COMMON" = ".git" ] || ROOT="$(cd "$ROOT" && cd "$(dirname "$COMMON")" && pwd)"
cd "$ROOT"
git fetch --prune origin >/dev/null 2>&1 || true
j() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

# branches mentioning the ticket
LOCAL=$(git for-each-ref --format='%(refname:short)' refs/heads | grep -i "$T" || true)
REMOTE=$(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -i "$T" | sed 's|^origin/||' || true)
BRANCHES="[]"
for b in $(printf '%s\n%s\n' "$LOCAL" "$REMOTE" | sort -u); do
  [ -n "$b" ] || continue
  ref="refs/heads/$b"; git show-ref --verify --quiet "$ref" || ref="refs/remotes/origin/$b"
  ab=$(git rev-list --left-right --count "origin/main...$ref" 2>/dev/null || echo "0	0")
  behind=${ab%%	*}; ahead=${ab##*	}
  last=$(git log -1 --format='%h %ad %s' --date=short "$ref" 2>/dev/null)
  islocal=false; git show-ref --verify --quiet "refs/heads/$b" && islocal=true
  isremote=false; git show-ref --verify --quiet "refs/remotes/origin/$b" && isremote=true
  same="n/a"; if $islocal && $isremote; then [ "$(git rev-parse "refs/heads/$b")" = "$(git rev-parse "refs/remotes/origin/$b")" ] && same=true || same=false; fi
  BRANCHES=$(node -e 'const a=JSON.parse(process.argv[1]);a.push({branch:process.argv[2],local:process.argv[3]==="true",remote:process.argv[4]==="true",in_sync:process.argv[5]==="n/a"?null:process.argv[5]==="true",ahead:+process.argv[6],behind_main:+process.argv[7],last:process.argv[8]});console.log(JSON.stringify(a))' "$BRANCHES" "$b" "$islocal" "$isremote" "$same" "$ahead" "$behind" "$last")
done

# worktrees for those branches
WTS="[]"
while IFS= read -r line; do
  case "$line" in worktree\ *) wt="${line#worktree }";; branch\ *) br="${line#branch refs/heads/}"; if echo "$br" | grep -qi "$T"; then dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' '); WTS=$(node -e 'const a=JSON.parse(process.argv[1]);a.push({path:process.argv[2],branch:process.argv[3],dirty_files:+process.argv[4]});console.log(JSON.stringify(a))' "$WTS" "$wt" "$br" "$dirty"); fi;; esac
done < <(git worktree list --porcelain)

# MRs (by source branch, then by search)
MRS="[]"
if command -v glab >/dev/null 2>&1; then
  for b in $(printf '%s\n%s\n' "$LOCAL" "$REMOTE" | sort -u); do
    [ -n "$b" ] || continue
    out=$(glab mr list --source-branch "$b" --all --output json 2>/dev/null) && MRS=$(node -e 'const a=JSON.parse(process.argv[1]);for(const m of JSON.parse(process.argv[2]||"[]"))if(!a.some(x=>x.iid===m.iid))a.push({iid:m.iid,state:m.state,merged:!!m.merged_at,draft:!!m.draft,title:m.title,source:m.source_branch,url:m.web_url,updated:(m.updated_at||"").slice(0,10),pipeline:m.head_pipeline?.status||null});console.log(JSON.stringify(a))' "$MRS" "$out")
  done
  out=$(glab mr list --search "$T" --all --output json 2>/dev/null) && MRS=$(node -e 'const a=JSON.parse(process.argv[1]);for(const m of JSON.parse(process.argv[2]||"[]"))if(!a.some(x=>x.iid===m.iid))a.push({iid:m.iid,state:m.state,merged:!!m.merged_at,draft:!!m.draft,title:m.title,source:m.source_branch,url:m.web_url,updated:(m.updated_at||"").slice(0,10),pipeline:m.head_pipeline?.status||null});console.log(JSON.stringify(a))' "$MRS" "$out")
fi

# openspec change, ship state, jira
OSROOT="."; [ -d openspec ] || { MR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"; [ -d "$MR/openspec" ] && OSROOT="$MR"; }   # untracked openspec/ lives in the main tree
SPEC=$(ls -d "$OSROOT"/openspec/changes/*"$T"* "$OSROOT"/openspec/changes/*"$(echo "$T" | tr 'A-Z' 'a-z')"* 2>/dev/null | head -1 | sed "s#^\./##" || true)
STATE=""; for w in "$ROOT" $(node -e 'for(const w of JSON.parse(process.argv[1]))console.log(w.path)' "$WTS"); do [ -f "$w/.claude/ship/$T/state.json" ] && STATE="$w/.claude/ship/$T/state.json" && break; done
STATE_STAGE=""; [ -n "$STATE" ] && STATE_STAGE=$(node -e 'const s=require(process.argv[1]);console.log(s.stage+(s.stopped?" STOP: "+s.stopped.reason:""))' "$STATE")
JIRA=""; command -v acli >/dev/null 2>&1 && JIRA=$(acli jira workitem view "$T" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const f=j.fields||j;console.log([f.status?.name||f.status,f.assignee?.displayName||f.assignee?.name||"",f.summary||""].join(" · "))}catch{}})' 2>/dev/null || true)

node -e '
const o={ticket:process.argv[1],branches:JSON.parse(process.argv[2]),worktrees:JSON.parse(process.argv[3]),mrs:JSON.parse(process.argv[4]),openspec:process.argv[5]||null,ship_state:process.argv[6]||null,ship_stage:process.argv[7]||null,jira:process.argv[8]||null};
const open=o.mrs.find(m=>m.state==="opened"), closed=o.mrs.filter(m=>m.state==="closed"&&!m.merged), merged=o.mrs.find(m=>m.merged);
o.situation = merged ? "merged" : open ? "mr-open" : closed.length ? "mr-closed-unmerged" : o.branches.length ? "branch-only" : "fresh";
o.suggest = {merged:"Ticket already merged: confirm with the user; probably nothing to ship.",
 "mr-open":`MR !${open?.iid} is open: resume at pipeline/review-mr (state the current pipeline and threads), do not re-plan.`,
 "mr-closed-unmerged":`MR ${closed.map(m=>"!"+m.iid).join(", ")} was closed without merging: ask the user whether to reuse the branch (rebase on origin/main, then review-code onwards) or start fresh.`,
 "branch-only":"Work exists on a branch with no MR: reuse it, run understand against the existing commits, then plan only what is missing.",
 fresh:"Nothing yet: normal loop from understand."}[o.situation];
if (process.argv[9]==="--human"){
  console.log(`Inventory for ${o.ticket} — ${o.situation}`);
  if(o.jira)console.log(`  Jira: ${o.jira}`);
  for(const b of o.branches)console.log(`  branch ${b.branch}: ${b.local?"local":""}${b.local&&b.remote?"+":""}${b.remote?"origin":""}${b.in_sync===false?" (local≠origin)":""} · ${b.ahead} ahead / ${b.behind_main} behind main · last ${b.last}`);
  for(const w of o.worktrees)console.log(`  worktree ${w.path} (${w.branch})${w.dirty_files?` · ${w.dirty_files} uncommitted file(s)`:" · clean"}`);
  for(const m of o.mrs)console.log(`  MR !${m.iid} ${m.state}${m.merged?" (merged)":""}${m.draft?" draft":""} · ${m.source} · ${m.title} · ${m.updated}${m.pipeline?" · ci "+m.pipeline:""}`);
  if(o.openspec)console.log(`  openspec: ${o.openspec}`);
  if(o.ship_state)console.log(`  /ship state: ${o.ship_stage} (${o.ship_state})`);
  console.log(`  → ${o.suggest}`);
} else console.log(JSON.stringify(o,null,2));
' "$T" "$BRANCHES" "$WTS" "$MRS" "$SPEC" "$STATE" "$STATE_STAGE" "$JIRA" "$HUMAN"
