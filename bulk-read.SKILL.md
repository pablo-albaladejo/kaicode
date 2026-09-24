---
name: bulk-read
description: Read large files or many files through a cheap model and get back a concise, cited answer. Use when you run on an expensive model (sol, opus, pro) and need to understand more than ~300 lines or more than 3 files, or when the read-shunt hook denied a Read.
---
# bulk-read

Reading is I/O, not thinking. When you run on an expensive model, do not load whole files into your context: ask a cheap model to read them and answer a concrete question. You pay for the answer, not for the files.

```bash
node ~/.claude/tools/bulk-read.mjs "<concrete question>" <file …>
```

- Files can be paths or globs (`src/retry/*.ts`). Total input is capped at ~300k tokens; split if needed.
- The answer is bullets with `path:line` references. Use them to `Read` only the exact window you will quote or edit (`offset` + `limit`, ≤ 350 lines).
- Ask one specific question per call: "which functions touch the retry give-up path and what do they return" beats "summarise this file". You can call it several times.
- Not for editing: the reader's line numbers are for locating, verify them with a small Read before an Edit.
- Not for judgement: subtle bugs, security and design are yours to reason about on the located code.

When the `read-shunt` hook denies a Read, it prints the exact command to run. Do not retry the same Read.
