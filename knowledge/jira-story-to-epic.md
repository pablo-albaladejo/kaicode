---
name: jira-story-to-epic
description: How to convert a Jira Story into an Epic in project APR with acli, and what the change does not do
metadata:
  type: reference
---

In project APR at `aircall-product.atlassian.net`, converting a Story into an Epic
is one command. Everything below was measured on 2026-09-28, not assumed.

**The operation:**

```bash
acli jira workitem edit --key <KEY> --type Epic
```

Confirmed on APR-7729 (Story -> Epic) and APR-7732 (Story -> Epic). Both answered
`Work item <KEY> has been successfully edited`.

**Pre-flight is not worth it.** The Atlassian MCP read tools could not preview
whether the change was allowed: `editmeta` came back unusable through that tool.
The cheap path is to attempt the edit and then re-read the issue. `acli jira workitem
edit --help` exposes `-t, --type`.

## The feared blocker did not happen

Both tickets had only Sub-task children (33 on APR-7729, 14 on APR-7732). A Sub-task
is hierarchyLevel -1 and an Epic is hierarchyLevel 1, so the worry was that Jira
would refuse the change or re-home the children. It did neither: after the conversion
the children are still Sub-tasks and still parented to the same key. All 47 survived.

## Gotcha: `acli jira workitem search` truncates silently

`acli jira workitem search` has a default result limit and returns a silently
truncated list. `--jql "parent = APR-7729"` reported 30 children while the issue's
own `subtasks` field reported 33. That looks exactly like data loss after a risky
edit, and it is not.

Rule: never trust a bare `acli jira workitem search` count as evidence of what
exists. When checking whether children survived a change, cross-check the `subtasks`
field of the parent against a `--paginate` search. Re-run with `--paginate` and the
count matches (33 on APR-7729).

## What the conversion does NOT do

The Sub-task children stay Sub-tasks. An Epic whose direct children are Sub-tasks is
unusual, and retyping them is manual work, not something `acli` does. `acli jira
workitem create` has `--parent`, but `acli jira workitem edit` has no `--parent`
flag, so re-parenting existing issues by CLI is not supported. The project does not
require an Epic Name value: the edit succeeded without one.

## Project facts

- APR is a classic software project. `acli jira project view --key APR --json` lists
  its issue types.
- Epic: id 10000, hierarchyLevel 1.
- Sub-task: id 10003, hierarchyLevel -1.
