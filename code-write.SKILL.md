---
name: code-write
description: Let a cheap model write a mechanical source file to disk from a spec and reference files (fixtures, table tests, migrations, types from a schema, a module mirroring another). Only for implementer agents on pro/sol; never for business logic.
---
# code-write

Writing boilerplate is output tokens, the most expensive kind on a big model. When the file is mechanical and tests will verify it, describe it and let a cheap model type it:

```bash
node ~/.claude/tools/code-write.mjs "<spec>" --out <new file> --ref <file to imitate> [--ref …]
```

- The spec says what the file contains, its inputs and outputs, and which reference to imitate. Under 40 characters it is refused.
- New files only. `--overwrite` exists for "replace this generated file whole"; not for edits.
- It refuses on `main`/`master`. It writes nothing else than `--out`.
- You never read the result whole. Run the tests and the linter, look at `git diff --stat`, fix failures with windowed Reads and Edits.
- Not for: business logic, anything security-sensitive, code you cannot verify by running it. If in doubt, write it yourself.
- `node ~/.claude/tools/code-write.mjs --report` shows how many generated files were kept vs edited afterwards: mostly edited means the specs were too vague.

Only implementer variants on pro/sol may run it (bash-guard denies the rest).
