# Editing Jira descriptions as ADF with `acli`

Verified on 2026-09-24 against APR-7729 in project APR at `aircall-product.atlassian.net`.

## Back up first

Always save the current work item before editing. This file is the rollback source:

```sh
acli jira workitem view <KEY> --json > /tmp/backup.json
```

## What does not work

1. This command with a bare ADF document in `f.json` fails:

   ```sh
   acli jira workitem edit --key X --description-file f.json --yes
   ```

   If `f.json` has top-level `type`, `version`, and `content` keys, `acli` returns `io.atlassian.micros.clibackend.exceptions.InvalidPayloadException: INVALID_INPUT`. There is no `--format`, `--adf`, or `--markdown` flag. `--description` and `--description-file` accept “plain text or ADF” and infer from the file content, but a bare ADF document is not accepted in that position.

2. Markdown passed through either `--description` or `--description-file` is saved as literal plain text: the reader sees `##` and `**` on screen. A restore that puts all the text in one `text` node collapses the description to one paragraph (`{doc:1, paragraph:1, text:1}`), destroying its structure.

## Recipe that works

Use `--from-json` with the wrapper shape. The `description` value in this wrapper is the real ADF document:

```json
{
  "issues": ["APR-7729"],
  "description": {
    "type": "doc",
    "version": 1,
    "content": [
      ... existing ADF nodes, copied verbatim ...,
      ... new ADF nodes ...
    ]
  }
}
```

To confirm the outer wrapper, run:

```sh
acli jira workitem edit --generate-json
```

It emits the JSON skeleton, but templates only `summary` and `type`; it does not show the `description` schema. Use the wrapper shape above for the description.

To append without losing the existing description:

1. Back up first as shown above.
2. Read the current description:

   ```sh
   acli jira workitem view APR-7729 --json
   ```

3. Take `fields.description.content` from that output. Copy those existing nodes verbatim into the wrapper's `description.content` array, then put the new nodes after them. Do not convert the existing nodes to text.
4. The tested accepted node types are `heading` (with `attrs.level`), `paragraph`, `bulletList`/`listItem`, and `strong` and `link` marks. A `link` mark needs `attrs.href`; an `inlineCard` needs `attrs.url`. The original description used `inlineCard` for its two Confluence links.
5. Save the complete wrapper as `f.json` and validate it:

   ```sh
   python3 -c "import json;json.load(open('f.json'))"
   ```

6. Send it:

   ```sh
   acli jira workitem edit --from-json f.json --yes
   ```

   Success prints `✓ Work item APR-7729 has been successfully edited`.

## Verifying

A success message does not prove the description retained its structure. Re-read the work item and count node types in `fields.description`:

```sh
acli jira workitem view APR-7729 --json > /tmp/after.json
python3 - <<'PY'
import json
from collections import Counter

issue = json.load(open('/tmp/after.json'))
counts = Counter()

def walk(node):
    if isinstance(node, dict):
        if isinstance(node.get('type'), str):
            counts[node['type']] += 1
        for child in node.get('content', []):
            walk(child)

walk(issue['fields']['description'])
print(dict(counts))
PY
```

A correct result has many `paragraph`, `heading`, `bulletList`, and `listItem` nodes. If the census is `{doc:1, paragraph:1, text:1}`, the write did not work: the description is one flat paragraph. Restore it from the backup taken before editing, and say that the write flattened the description.

## Transitioning to Done with a resolution (e.g. "Won't Do") is not possible from `acli`

Verified on 2026-09-26 against project APR at `aircall-product.atlassian.net`.

In project APR, `Won't Do` is a **resolution**, not a status: APR-7765 has status `Done` +
resolution `Won't Do`; there is no `Won't Do` status, so
`transition --status "Won't Do"` returns `No allowed transitions found for given status`.

The `Done` transition for APR-7773 (id 421) has `hasScreen: true`; the resolution is mandatory on
that screen, and `acli` never sends it, so the server rejects it:
`io.atlassian.micros.clibackend.exceptions.InvalidPayloadException: The selected resolution cannot be chosen during this action.`
This is Jira-side, not an acli bug.

`transition` has no `--resolution` flag (unknown flag), no `--fields`, and no payload option;
`--json` is output-only. `transition --help` in **1.3.39-stable** (verified 2026-09-26, after
upgrading from 1.3.5) prints the same 8 flags as 1.3.5: `--filter`, `-h/--help`,
`--ignore-errors`, `--jql`, `--json`, `-k/--key`, `-s/--status`, `-y/--yes`.

`edit --from-json` cannot do it either: its `--generate-json` template top-level keys are
`assignee, description, issues, labelsToAdd, labelsToRemove, summary, type` — no `resolution`; a
payload adding it fails with `✗ Error: failed to generate JSON`.

No `acli api` command exists (in 1.3.5 or 1.3.39), so the CLI cannot reach REST.

The only supported ways are the Jira UI, or the REST call
`POST /rest/api/3/issue/{key}/transitions` with body
`{"transition":{"id":"421"},"fields":{"resolution":{"name":"Won't Do"}}}` — documented at
developer.atlassian.com Jira platform REST v3, Issues, "Transition issue" (its description
explicitly covers updating transition-screen fields via `fields`/`update`). Do not record or use an
API token; note only that this call is outside acli's reach.

Harness consequence: `~/.claude/tools/cc-clean.sh` line 55 calls
`acli jira workitem transition --key "$T" --status "Done"`, so `cc-clean.sh --jira-done` will fail
for any APR ticket whose Done transition has that screen; the human has to close it in the UI.

Community search engines were unreachable when this was checked, so no community workaround is
recorded.

The REST equivalent that DOES work is documented in `jira-close-as-wont-do.md` (transition to Done + `fields.resolution` in one call; `204` on success). `acli` itself still cannot do it.

## Documentation and CLI dead ends

Atlassian's official `jira workitem edit` and `jira workitem create` reference pages only say “plain text or ADF”; neither publishes an example payload. The changelog page returns 404, and `--generate-json` does not template the description schema. Do not spend another round trip looking for an example there. `acli` has no `api` command, so its CLI cannot reach the REST v3 endpoint. For editing a description as ADF, which is what this file covers, that costs nothing: `acli` has a working path, so do not switch to a hand-rolled `curl` with a token there. That advice is scoped, not universal — where `acli` has no path at all, closing an issue with a resolution being the worked example, the REST call is the supported fallback; see `jira-close-as-wont-do.md`.
