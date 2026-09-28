# conversation-ai-monitoring — codebase map
<!-- map: 2026-09-25 · head e6a5640 · fireworks/deepseek-v4.1-flash · 20046 in (208 cached) / 2161 out · $0.006 · refresh: node ~/.claude/tools/repo-map.mjs --refresh -->

## Purpose
Serverless, event-driven AWS service that stores and organizes AI-generated call results and transcripts for Aircall's voice-AI platform, respecting customer consent and retention policies. Consumers are internal Aircall teams (agent-productivity) integrating LLM monitoring via SNS/SQS and Braintrust.

## Layout
- `src/infrastructure/` — secondary adapters: Braintrust mappers (`braintrust/mapper/ai-result-span-mapper.ts`, `llm-response-mapper.ts`), API clients, DynamoDB/logging utilities.
- `src/entry-points/` — primary adapters: `sqs/` Lambda handlers, `fakes/` mock HTTP endpoints for sandbox, `shared/` middleware (logging, error handling, `llm-log-data-store.ts`).
- `(root)` — SAM/CloudFormation templates (`template.yaml`, `template-event-subscription.yaml`, `template-backfill-event.yaml`, `template-storage.yaml`, `template-fakes.yaml`), `package.json`, `tsconfig.json`, `eslint.config.mjs`, `samconfig.toml`.
- `src/application/` — use-cases, service interfaces, shared domain constants.
- `src/tests/` — shared test fixtures.
- `.gitlab/ci/` — local CI job includes; `.gitlab-ci.yml` at root.
- `src/domain/` — pure domain entities (no imports from other layers).
- `scripts/backfill/` — CLI to send backfill messages to LLM-result / transcription SQS queues.
- `.sam-envs/` — per-environment SAM parameter files (`sandbox`, `staging`, `production`).
- `doc/` — `Braintrust-Backfill.md`, `AI-Monitoring-Integration.md`.
- `src/e2e/`, `__mocks__/@aircall-node-libraries/` — e2e tests and library mocks.

## Run · test · lint
- `npm ci` · `npm run husky:install` — install + git hooks
- `npm run test` — `tsc` compile + unit tests
- `npm run test:unit` — Vitest unit tests only
- `npm run test:coverage` — coverage report
- `npm run test:watch` — watch mode
- `npm run test:integ` — integration tests (`vitest.config-integ.mts`); needs `DEPLOYED_STACK_NAME=sandbox-conversation-ai-monitoring-{ticket}`
- `npm run test:e2e` — e2e (`vitest.config-e2e.mts`)
- One test file: `npx vitest run src/infrastructure/braintrust/mapper/ai-result-span-mapper.test.ts`
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format:check` / `npm run format:write` — Prettier
- `npm run build` — `sam build --parallel`; `npm run validate` — `./scripts/sam_validate.sh`; `cfn-lint` for templates

## CI / deploy
Stages in order (`.gitlab-ci.yml`): `bootstrap` → `build` → `package` → `deploy-sandbox` → `test-sandbox-integration` → `test-sandbox-e2e` → `quality` → `security` → `deploy-staging` → `tag-release` → `deploy-production`.
- Feature branches / MRs: build, package, deploy to a per-ticket sandbox stack (`sandbox-conversation-ai-monitoring-{ticket}`), then integration + e2e tests against it.
- Merge to default branch or `hotfix/*`: staging deploy jobs run; production deploy is gated (`prod-deploy-job: deploy-production` from `release-workflow.v3.yml`; `.job-rule-main-or-hotfix-manual` marks manual jobs).
- Tag pipelines (`$CI_COMMIT_TAG`) drive `tag-release` and `deploy-production`.
- Remote templates supply airstage catalog, aws-sam, iac-policies, security, release workflow; `.gitlab/ci/security.gitlab-ci.yml` and `.snyk` are owned by `@aircall/teams/security` (`.gitlab/CODEOWNERS`).

## Data
- No migrations directory is tracked (`migrations: none`); no `db:*` scripts exist in `package.json` despite `CLAUDE.md`/`.cursor/rules/agent.mdc` listing `db:generate`, `db:migrate`, `db:migrate:manual`, `db:drop`.
- `drizzle-orm` and `drizzle-kit` are dependencies; `CLAUDE.md` describes PostgreSQL with pgvector and environment-specific schemas (sandbox/staging/production), but the schema/migration folder and per-environment apply procedure are not stated in the scanned files.
- Primary persistence in the scanned templates is S3 (`ConversationAIMonitoringBucket`, `LLMResultGeneratedBucket`) plus SQS/SNS queues and DynamoDB utilities under `src/infrastructure/shared/`.

## Conventions
- Hexagonal/Clean Architecture with ESLint-enforced boundaries (`eslint.config.mjs`): `domain` cannot import `application`/`infrastructure`/`entry-points`; `application` cannot import `infrastructure`/`entry-points`; `infrastructure` cannot import `entry-points`. Tests (`*.test.ts`, `*.integ-test.ts`) are exempt.
- TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, explicit function return types required; absolute imports from `src/` (`baseUrl: "src"`).
- `const` over `function`; `Array<T>` over `T[]`; `zod` for validation; `camelCase` schema names with `Schema` suffix; `kebab-case` file names; use-cases named as verb phrases.
- No `process.env` outside `infrastructure`/`entry-points`; inject configuration.
- Tests co-located as `*.test.ts`; integration as `*.integ-test.ts`; fixtures in `src/tests/`; mocks in `__mocks__/`. 90%+ coverage, AAA pattern.
- Conventional Commits with ticket suffix, e.g. `feat: [apr-1234] add ...`; commitlint + Husky pre-commit (ESLint, Prettier, tsc).
- `no-console` is an error; use the structured logger.

## Where to start
- Braintrust span/result mapping bug — `src/infrastructure/braintrust/mapper/ai-result-span-mapper.ts`, `src/infrastructure/braintrust/mapper/llm-response-mapper.ts`, `src/infrastructure/braintrust/log-ai-result-session.ts` (plus their `.test.ts` siblings).
- Event subscription / queue wiring — `template-event-subscription.yaml` (most-changed file), `template.yaml`, `.sam-envs/{sandbox,staging,production}`.
- Backfill behavior — `scripts/backfill/send-backfill-message.ts`, `template-backfill-event.yaml`, `doc/Braintrust-Backfill.md`.
- New SQS-triggered feature — `src/entry-points/sqs/`, `src/application/use-cases/`, `src/infrastructure/services/`, then the matching `template-*.yaml`.
- LLM log capture integration — `src/entry-points/shared/llm-log-data-store.ts` and `doc/AI-Monitoring-Integration.md`.

## Hotspots (90d, from git)
- 5× template-event-subscription.yaml
- 4× .sam-envs/production
- 3× src/infrastructure/braintrust/mapper/ai-result-span-mapper.ts
- 3× .sam-envs/staging
- 3× .sam-envs/sandbox
- 2× template.yaml
- 2× template-backfill-event.yaml
- 2× src/infrastructure/braintrust/mapper/llm-response-mapper.ts
- 2× src/infrastructure/braintrust/mapper/ai-result-span-mapper.test.ts
- 2× src/infrastructure/braintrust/log-ai-result-session.test.ts

## Owners
- CODEOWNERS: .gitlab/CODEOWNERS
- 13 commits · Ahmed Saleh
- 4 commits · Manuel Ventero
- 3 commits · Caio Castro
- 1 commits · Benjamin Ramírez
- 1 commits · Cyril Ruault
- 1 commits · David Torres

## Gotchas (kept by /ship Learn — one line each, newest last)
- (none yet)
