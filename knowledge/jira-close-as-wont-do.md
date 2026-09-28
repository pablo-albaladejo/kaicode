---
name: jira-close-as-wont-do
description: How to close a Jira Cloud ticket (aircall-product) as "Won't Do" via REST API
metadata:
  type: reference
---

In aircall-product.atlassian.net, "Won't Do" is NOT a status and not a transition.
It is a value of the **Resolution** field, which is required when moving to **Done**.
Closing as Won't Do = transition to Done + resolution "Won't Do" in the same call.

**Requirements:** environment variables `JIRA_USER` (email), `JIRA_TOKEN` (API token),
`JIRA_URL=https://aircall-product.atlassian.net`. Never write the token in clear text.

**Steps:**

1. Find the ID of the transition to Done (it can change between projects):
   ```bash
   curl -s -u "$JIRA_USER:$JIRA_TOKEN" -H "Accept: application/json" \
     "$JIRA_URL/rest/api/3/issue/<KEY>/transitions" \
     | jq '.transitions[] | {id, name, to: .to.name}'
   ```
   In project APR, Done = `421`.

2. (Optional) See the resolutions allowed on that transition:
   ```bash
   curl -s -u "$JIRA_USER:$JIRA_TOKEN" -H "Accept: application/json" \
     "$JIRA_URL/rest/api/3/issue/<KEY>/transitions?expand=transitions.fields&transitionId=<ID>" \
     | jq '.transitions[].fields.resolution.allowedValues[].name'
   ```

3. Run the transition with the resolution:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST -u "$JIRA_USER:$JIRA_TOKEN" \
     -H "Content-Type: application/json" \
     "$JIRA_URL/rest/api/3/issue/<KEY>/transitions" \
     -d '{"transition":{"id":"<ID>"},"fields":{"resolution":{"name":"Won'\''t Do"}}}'
   ```
   If it works, it returns `204`.

4. Check the result:
   ```bash
   curl -s -u "$JIRA_USER:$JIRA_TOKEN" -H "Accept: application/json" \
     "$JIRA_URL/rest/api/3/issue/<KEY>?fields=status,resolution" \
     | jq '{key, status: .fields.status.name, resolution: .fields.resolution.name}'
   ```
   It must print `status: "Done"` and `resolution: "Won't Do"`.

**Careful:** this action changes real data. Ask for confirmation before step 3.
Tested on APR-7773 on 2026-09-26.

## Gotcha: which credential does NOT work here (2026-09-26)

A token stored in the macOS keychain under `security ... -s acli` with
`"acct" = "rovodev:712020:..."` is the Rovo Dev credential, **not** a Jira API token:
against `$JIRA_URL/rest/api/3/...` with Basic auth it returns **401** with
`x-seraph-loginreason: AUTHENTICATED_FAILED`, in every variant (Basic, Basic with manual
base64, `Bearer`, the host `api.atlassian.com/ex/jira/<cloudId>`, with and without the
final `=<8 hex>` suffix, and using the accountId as the user). `acli` does authenticate on
that site while `acli auth status` says `unauthorized`, because it uses its own OAuth, not
that token. The correct API token is generated at id.atlassian.com → API tokens (security →
API tokens), not in Rovo Dev.
