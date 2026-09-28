# conv-ai-settings — codebase map
<!-- map: 2026-09-24 · head 4bf5aefe · fireworks/deepseek-v4.1-flash · 46741 in / 4497 out · $0.013 · refresh: node ~/.claude/tools/repo-map.mjs --refresh -->

## Purpose
`conv-ai-settings` is the configuration service for Aircall's conversational-AI workflows: the system of record for per-company company context, custom vocabulary, knowledge base and the AI Assist activation wizard (`README.md`, `docs/integration.md`).
Its consumers are VoiceAI backend services (internal REST, SigV4) and the dashboard (merged AppSync GraphQL, Cognito).

## Layout
- `src/domains/` — all business code, one Clean-Architecture tree per domain (`domain/` → `application/` → `infrastructure/` → `entry-points/`, plus `tests/`); domains are `activation/`, `company-context/`, `custom-vocabulary/`, `knowledge-base/`, `shared/`.
- `src/domains/activation/` — the AI Assist activation wizard; entry point is `entry-points/app-sync/lambda/app.ts` (knip's only entry for the domain), published contract in `entry-points/app-sync/graphql/schema.graphql`, adapters in `infrastructure/`, shared test support in `tests/`.
- `src/domains/shared/` — cross-domain infrastructure: DB client, Drizzle migrations, AppSync middleware (authorizer, error handler, logger), AWS helpers.
- `src/evaluations/` — offline evaluation suite and CLI (`cli.ts`, `validate-fixtures.ts`, `report-scorers.ts`); eslint `boundaries/external` forbids evaluation frameworks on a request path.
- `template*.yaml` (root) — SAM/CloudFormation; `template.yaml` registers each domain's nested stack.
- `.gitlab/ci/` — job definitions included by `.gitlab-ci.yml`; `.gitlab/CODEOWNERS` maps domains to owning teams.
- `docs/` — architecture, integration guide, activation API and wizard-lock references; `docs/evaluations/` holds generated baselines.
- `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/` — canonical agent and coding guidance; `scripts/sam_validate.sh` — template validation.

## Run · test · lint
- `nvm use && npm ci && npm run husky:install` (needs `GEMFURY_AUTH`; copy `.env.example` to `.env`)
- `npm run compile` — `tsc`
- `npm run test` — compile + unit tests
- `npm run test:unit` — `vitest run`
- `npm run test:coverage` — `vitest run --coverage`
- `npm run test:integ` — `vitest run -c vitest.config-integ.mts`
- `npm run test:e2e` — `vitest run -c vitest.config-e2e.mts`
- `npm run test:watch` — `vitest`
- one test file: `npx vitest run <path/to/file>.test.ts` (vitest path filter; no per-file script in `package.json`)
- `npm run lint` — `eslint . --fix --max-warnings=0 --no-warn-ignored`
- `npm run format:check` / `npm run format:write` — Prettier
- `npm run validate` — `./scripts/sam_validate.sh`; `npm run build` — `sam build --parallel`
- `npm run db:generate` / `db:migrate` / `db:migrate:manual` / `db:drop` / `db:seed:templates`
- `npm run codegen:schema` — GraphQL codegen; `npm run knip` — unused-file gate (pre-commit only)

## CI / deploy
- Stages in order: `bootstrap`, `build`, `package`, `deploy-sandbox`, `integration-test-sandbox`, `e2e-test-sandbox`, `quality`, `security`, `deploy-staging`, `tag-release`, `deploy-production` (`.gitlab-ci.yml`).
- `.gitlab-ci.yml` includes remote Aircall templates (`aws-sam.v3`, `iac-policies.v1`, `security.main`, `release-workflow.v3` with `prod-deploy-job: deploy-production`) plus local `.gitlab/ci/*.gitlab-ci.yml`.
- Workflow rules: MR pipelines for any branch; branch pipelines only when no MR is open; tag pipelines on tag.
- Job rules: `.job-rule-feature-branch` (MR / non-default branch), `.job-rule-main-or-hotfix` (default branch or `hotfix/*`), `.job-rule-main-or-hotfix-manual` (same, `when: manual`), `.job-rule-release-tag` (tag only).
- Deploys: sandbox stack per ticket (`TICKET_SUFFIX` parsed from the branch name, e.g. `APR-7557`), then staging, then production via the release workflow; `deploy-production` is the gated prod job.
- `lint` is `allow_failure: true` in `.gitlab/ci/build.gitlab-ci.yml`; `npm run knip` runs only from `.husky/pre-commit`, never in CI.
- What exactly runs on merge to main vs on a tag beyond these rules: not stated.

## Data
- Aurora PostgreSQL, one instance shared by all domains; PostgreSQL schema name is environment-driven via `ENV` (`sandbox`/`staging`/`production`) (`docs/architecture.md`).
- ORM/migration tool: Drizzle ORM + `drizzle-kit`; table schemas in `src/domains/**/infrastructure/database/schema/*.sql.ts`.
- Migrations folder: `src/domains/shared/infrastructure/database/migrations/{sandbox,staging,production}/` (11 files each; last `0010_lowercase_keyword_languages.sql`); generated name `NNNN_conv-ai-settings_migration.sql` (`--name conv-ai-settings_migration`), plus `snapshot.json`.
- Applied with `ENV=<env> npm run db:migrate` (connects via AWS Secrets Manager credentials, applies pending migrations in order, updates the history table); feature branches use `ENV=sandbox-<ticket> npm run db:migrate:manual` (`docs/database-migrations.md`). How CI applies them per environment: not stated.
- Table prefixes: `cv_` (custom-vocabulary), `cc_` (company-context).
- Activation wizard state is DynamoDB, not Postgres (`docs/activation-wizard-lock.md`).

## Conventions
- Layer direction `domain → application → infrastructure → entry-points` is enforced by eslint `no-restricted-imports` per layer and `eslint-plugin-boundaries`; never import another domain's internals; `process.env` only in `entry-points`/`infrastructure` (`AGENTS.md`, `eslint.config.mjs`).
- kebab-case filenames; use-cases verb-phrase; repository interfaces noun-named; `Array<T>` over `T[]`; `??` over `||`; zod for input validation; absolute imports from `src/`; `const` over `function`; comments are the exception, never ticket-referencing.
- Tests: unit co-located `*.test.ts`, integration `*.integ-test.ts`, e2e `*.e2e-test.ts`; Arrange/Act/Assert; full-object `toStrictEqual`; data from rosie + faker factories in `src/domains/<domain>/tests/fixtures/*.fixtures.ts`; shared behaviour in `tests/<topic>/<topic>.utils.ts`; no repo-level `src/tests/`.
- Commits: `@commitlint/config-conventional` via husky; pre-commit runs lint-staged and `knip`.
- Never hand-edit generated files: `entry-points/app-sync/graphql/schema.ts`, `docs/evaluations/results/**`, `docs/evaluations/threshold-policy.md`.
- Ownership: `.gitlab/CODEOWNERS` — `activation/**` and `company-context/**` → `@aircall/teams/agent-productivity`, `custom-vocabulary/**` → `@aircall/teams/conversational-intelligence`.

## Where to start
- Wizard lock / ownership refusal — `docs/activation-wizard-lock.md` (conditions and lifecycle), `src/domains/activation/infrastructure/wizard-state/activation-wizard-record-repository.ts`, `.../with-activation-wizard-ownership.ts`, `src/domains/activation/application/repositories/activation-wizard-state.ts`.
- New or changed GraphQL operation — `src/domains/activation/entry-points/app-sync/graphql/schema.graphql`, `.../graphql/permissions.ts`, `.../lambda/resolvers/index.ts`, `.../lambda/app.ts`, then `npm run codegen:schema`.
- Company context read/generate/save — `src/domains/activation/infrastructure/company-context/activation-company-context.ts`, `src/domains/activation/application/repositories/activation-company-context.ts`, `src/domains/activation/domain/activation-company-context.ts`, `docs/activation-api.md`.
- Schema or migration change — `src/domains/<domain>/infrastructure/database/schema/*.sql.ts`, `src/domains/shared/infrastructure/database/migrations/<env>/`, `docs/database-migrations.md`.
- Evaluation regression — `src/evaluations/cli.ts`, `src/evaluations/policy/evaluation-policy.ts`, `docs/evaluations/AGENTS.md`.

## Hotspots (90d, from git)
- 42× src/domains/activation/AGENTS.md
- 31× src/domains/activation/entry-points/app-sync/lambda/app.ts
- 29× src/domains/activation/entry-points/app-sync/lambda/app.test.ts
- 29× src/domains/activation/entry-points/app-sync/graphql/schema.ts
- 29× src/domains/activation/entry-points/app-sync/graphql/schema.graphql
- 23× src/domains/activation/entry-points/app-sync/graphql/schema.test.ts
- 21× src/domains/activation/tests/fixtures/activation.fixtures.ts
- 19× src/domains/activation/entry-points/app-sync/lambda/resolvers/index.ts
- 17× src/domains/activation/infrastructure/AGENTS.md
- 16× template-activation-appsync.yaml

## Owners
- CODEOWNERS: .gitlab/CODEOWNERS
- 104 commits · Pablo Albaladejo
- 8 commits · Gonzalo Plaza
- 6 commits · Manuel Ventero
- 3 commits · Botond Berde
- 2 commits · David Torres
- 1 commits · Antonin Blin

## Gotchas (kept by /ship Learn — one line each, newest last)
- 2026-09-24 APR-7557: CI never applies a new migration to a feature-branch sandbox — migrate-db-schema-feature-branch runs db:migrate:manual pinned to 0000; a green pipeline says nothing about the migration.
- 2026-09-24 APR-7557: per-branch sandbox DBs are off ~21:00–06:00 UTC (pg-proxy 500, downstream jobs skipped, not passed).
- 2026-09-24 APR-7557: branches sharing a ticket suffix share the sandbox schema without a lock.
- 2026-09-24 APR-7557: a mutation only tests the guard if it removes the whole guard — replacing the CASE with `jsonb_typeof(k.languages) = 'array' AND EXISTS (... jsonb_array_elements ...)` reddens nothing, because PGlite 0.3.15 short-circuits the AND and the scalar row never reaches jsonb_array_elements; the bare EXISTS without the AND raises `cannot extract elements from a scalar` and reddens all five behaviour tests.
- 2026-09-24 APR-7558: `.sam-envs/*` is in `.prettierignore`, so `npx prettier --no-cache --check` reports "All matched files use Prettier code style!" for it even when explicitly passed a malformed file — a false pass; the real gate is `sort -c <file>`, run by `.lintstagedrc.js` at pre-commit, and removing the ignore entry breaks `format:check` because Prettier infers no parser for these extensionless files.

## Discarded work (2026-09-24, ticket Done + Won't Do)

APR-7557 was closed as Won't Do: the measurement came back clean in all three environments
(sandbox 0 of 0 rows, staging 0 of 21, production 0 of 5117), so the data migration the ticket
made conditional on it would have touched no rows. The close was done by the human in the Jira
UI, because `acli` cannot set a resolution (see the note in `acli-jira-description-adf.md`); that
session's own transcript (2026-09-24, session 308b974a) records it hit "Won't Do does not
exist as a status in this project" (translated from Spanish) and left the ticket for the human. MR !248 was closed unmerged and the branch
`feat/APR-7557` was deleted both on the remote and locally. Its tip was `75a87de8`; the three
commits were `d77eb29b` (migration 0010 in all three env folders), `47d3c132` (staging measurement
in the decision record) and `75a87de8` (populated-upgrade test proving the journal goes
`0000-0009` to `0000-0010`). They remain reachable through the shared repo's reflog until a gc,
after which they are gone. If the decision is ever revisited, re-run the measurement first rather
than resurrecting the migration without new evidence.
