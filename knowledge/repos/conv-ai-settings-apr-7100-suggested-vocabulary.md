# APR-7100 — Suggested vocabulary from the company context (handoff)

**Date:** 2026-09-25 · **Worktree:** `~/development/conv-ai-settings-worktrees/APR-7100` (branch `feat/APR-7100`, from `origin/main` @ `a2d7c41d`)

## 1. The question and the answer

Asked: which ticket implements "when a company context is generated, a custom vocabulary is also generated". Answer: **none today.** No code path turns a company context into vocabulary terms; `custom-vocabulary` has CRUD only. The work is split across four To Do subtasks of APR-7729.

## 2. Ticket digest (all To Do, subtasks of APR-7729, no subtasks of their own)

- **APR-7095** "Build a richer company profile from the customer's website" — provider-neutral structured research over `/v2/scrape` producing `suggestedVocabulary`; excludes materialization. AC: adapter passes the shared structured-research contract tests; `/v2/scrape` bounded and schema-valid; legacy scrape-plus-Azure endpoint unchanged. Relates to APR-7100, APR-7094, APR-7230, APR-7231, APR-7242; blocks APR-7094 and APR-7241.
- **APR-7100** "Suggest vocabulary terms automatically from the company context" — the planner/materializer: normalize and order candidates, re-read the latest eligible profile, resolve vocabulary and language, idempotency, capacity planning, atomic completion. No separately labelled AC section. Relates to APR-7095, APR-7103; **is blocked by** APR-7234, APR-7245; blocks APR-7103, APR-7249.
- **APR-7246** "Share company context changes so vocabulary can be suggested from them" — latest-eligible-v2-profile read, async request publication, revision/correlation mapping, additive generated-source fields in vocabulary reads, GraphQL mapping + codegen. Blocked by APR-7234; blocks APR-7249.
- **APR-7249** "Run vocabulary suggestions automatically in the background and roll them out" — subscriber + worker, bounded retries/DLQ, stale/duplicate handling, tests, redrive guidance, **disabled-by-default rollout**. Blocked by APR-7246, APR-7245, APR-7100; names APR-7234 and APR-7244 as dependencies.

## 3. The chain

Enforced (Jira `Blocks`): APR-7234 → APR-7100 and APR-7246; APR-7245 → APR-7100; {APR-7100, APR-7246, APR-7245} → APR-7249; APR-7100 → APR-7103.

- **APR-7100 does NOT depend on APR-7246.** They are parallel lines converging on APR-7249. APR-7246 supplies the event and the read exposure APR-7249 needs.
- **APR-7095 → APR-7100 is `Relates`, not `Blocks`.** The dependency is functional, not enforced: APR-7100 can be built and tested against the profile contract, but today's generator carries only description/products and cannot supply real candidates. APR-7729's waves put APR-7100 in Wave 1 and APR-7095 in Wave 2, so an early materializer stays dormant — deliberately.

## 4. Ground truth about `origin/main`

- HEAD-only reads of this repo mislead: the primary checkout is **39 commits behind** `origin/main` (`git rev-list --left-right --count origin/main...HEAD` → `39 0`).
- Provenance work is **merged on `origin/main`** as the squash commit `5b9061e4 feat(vocabulary): [APR-7234] record where each generated vocabulary term came from`. The pre-squash commit `a259b5d8` is only on the remote feature refs (`apr-7234-vocabulary-provenance`, `apr-7245-atomic-add-keywords`) and is not an ancestor of main — the squash pattern AGENTS.md documents.
- Schema exists on `origin/main`: `src/domains/custom-vocabulary/infrastructure/database/schema/keyword-materializations.sql.ts`, with the `0010` migrations for production/sandbox/staging and `keyword-provenance-migration.test.ts`. Confirm the migration is applied before generated writes.
- Live adapter on `origin/main`: `src/domains/activation/infrastructure/company-context/activation-company-context.ts` explicitly maps `suggestedVocabulary: undefined`. The contract placeholder already exists; the canned adapter is pre-`origin/main` history.
- The company-context generation object carries only description/products, and the schema mapping refuses v2.
- `PrefillGenerationEnabled` **is** declared in `template.yaml` and `template-company-context-app.yaml` with default false. APR-7729's "Not verified" note about it is stale. It is **not** the vocabulary-worker flag.

## 5. Ordered plan

1. Start from synced `origin/main` (worktree `APR-7100` @ `a2d7c41d`). Confirm the `0010` migration is applied; complete APR-7245's atomic capacity boundary.
2. APR-7095 — structured research alongside `src/domains/company-context/application/services/scrape-url.ts` and `src/domains/company-context/application/use-cases/generate-company-context-object-from-url.ts`; extend `src/domains/company-context/infrastructure/database/repositories/company-context-mapping.ts`. Done when a valid rich draft contains candidates and the legacy route is unchanged.
3. APR-7246 — expose eligible profile revision and publish the materialization request through company-context's application/entry-point boundary; add generated provenance to `src/domains/custom-vocabulary/entry-points/app-sync/graphql/schema.graphql` and its get-keywords resolver.
4. APR-7100 — the planner against `src/domains/custom-vocabulary/application/repositories/keyword.ts`, `src/domains/custom-vocabulary/application/use-cases/add-keywords.ts` and the materialization/provenance tables. Done when duplicate or stale requests cannot create extra terms, capacity stays bounded, user-owned terms survive.
5. APR-7249 — compose subscriber/worker with the materializer, then queue/DLQ and a **separate default-off vocabulary rollout control** in `template-custom-vocabulary-app.yaml`.

Seam (per the SC pages): derivation belongs to company-context, automatic materialization to custom-vocabulary; **wizard approval is not required**; the existing glossary management stays the place to edit/remove terms.

## 6. Decisions already taken

- Design the materializer seam now (contract + offline half, tests against the contract fixture), behind its **own default-off flag**; stay off until a real producer exists.
- Wave 1 (APR-7246, APR-7100) may **merge with materialization off**, even though nothing in it verifies end to end without a producer: Jira's wave order and the functional dependency point in different directions, and we follow Jira's order for merging.
- Do not build a producer to unblock Wave 1; the live adapter's `undefined` stays the only source while the flag is off.

## 7. Open questions (human)

- Which profile saves publish materialization requests — human edits and prefills included?
- What makes a v2 profile "eligible"?
- On a collision between a normalized generated term and a user term, which side wins?
- The worker flag's name and default (explicitly **not** `PrefillGenerationEnabled`).
- The 100-term cap needs the atomic count+insert from APR-7245; non-atomic count+insert can exceed it.

Specify these in an APR-7100 OpenSpec proposal written **in the APR-7100 worktree** (`openspec/changes/`), not from another ticket's session: `openspec/` is untracked and per-worktree.

## 8. Risks

- Enabling before a real v2 producer yields no suggestions (dormant functionality ships).
- Non-atomic count+insert can exceed the 100-term limit.
- Replay or revision races can overwrite customer choices.

## 9. Out of scope

APR-7103's company-name rule, frontend approval UI, production backfill.

## 10. Operational note

The Atlassian MCP connector is configured on the deprecated HTTP+SSE endpoint (unsupported after 2026-06-30). Migrate to `https://mcp.atlassian.com/v2/mcp` and reconnect OAuth.

## 11. Sources

Jira: APR-7729 (description, waves, subtasks), APR-7095, APR-7100, APR-7246, APR-7249, APR-6165 (Done, Firecrawl `/scrape` + LLM, no vocabulary), APR-7234. Confluence (space SC): page 5154537483 (research), page 5196251314 (TDD). Commits: `5b9061e4` (APR-7234 squash), `a259b5d8` (pre-squash ref), `ca06dfe5` (APR-6165 Firecrawl). Findings dated 2026-09-25.
