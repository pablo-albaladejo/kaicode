#!/usr/bin/env bash
# People: who is who across projects and how to write to each person (tools/people.mjs → ~/.claude/knowledge/people.json,
# local only, not versioned). Installs the tool and seeds what we already know. Re-running only updates the seeds.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"; DST="$HOME/.claude"
cp "$SRC/tools/people.mjs" "$DST/tools/people.mjs"; echo "  ✓ tools/people.mjs"
P="node $DST/tools/people.mjs"
$P set "Lidia Cancio Valle" role="UX Designer" slack=U07DS5JCHQU email=lidia.valle@aircall.io projects+=proj-ai-assist-activation \
  style="Designer: write about the user experience and the decision she has to make. No code, API, field or file names. Plain English (B1), short sentences, friendly, no dashes. 5 to 8 lines." source=user >/dev/null
[ "$($P get Lidia | grep -c 'too long and technical')" = 0 ] && $P note Lidia "A technical draft on the configured-line contract was rejected as too long and technical; the short version (how rare, what the user would see, one proposal, one question) worked." >/dev/null
$P set "Pierre Goutheraud" slack=U01SYBGK5U2 email=pierre.goutheraud@aircall.io projects+=proj-ai-assist-activation >/dev/null
$P set "me" role="Pablo Albaladejo, software engineer (the user)" slack=U08HKQWTJN4 email=pablo.albaladejo@aircall.io \
  style="Everything under his name follows lead.md Voice: B1 English, human, simple, direct, humble, useful, no dashes or machine marks. Adapt depth to the reader." source=user >/dev/null
echo "  ✓ seeded: $($P list | wc -l | tr -d ' ') people · file: $DST/knowledge/people.json (local, not in kaicode)"
