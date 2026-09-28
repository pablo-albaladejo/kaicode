# next-actions — migration engine & region routing (APR-7618)
<!-- kept by hand from APR-7618 session 2026-09-25/26 -->

## Purpose
`next-actions` is an AWS serverless service that generates AI next-actions from call transcriptions. Two subsystems matter here: the **migration engine**, which moves a company's data between AWS regions, and **region routing**, which decides which region serves a company at request time (catalogue-first: a `region` pin on a migration-catalogue row wins over the default). `AGENTS.md` / `CLAUDE.md` are canonical for the repo itself — this page is the hand-kept operational knowledge.

## The cheap way to tell which commit an environment is really running
SAM deploys through a `computed.template` published under an artifact prefix derived from `CI_COMMIT_SHORT_SHA` (`next-actions/<sha8>/`). The stack's `TemplateBody` therefore names the prefix of the commit actually deployed — the pipeline colour does not.

```sh
aws cloudformation get-template --stack-name <STACK> --template-stage Original \
  --query TemplateBody --output json | grep -o 'Key: next-actions/[a-z0-9]*/'
```

For Step Functions the artefact is not enough: the state machine does **not** hot-reload on its own, so read the live definition. `updateDate` is always `None` on this resource, so use a decisive marker instead:

```sh
aws stepfunctions describe-state-machine --state-machine-arn <ARN> \
  --query definition --output text | jq -r .StartAt
```

Two traps:
- `grep`ping a template fetched through an inline/object `jq` path can silently return **0 matches** — SAM stores the ASL as an S3 artifact, not inline. Fetch the artefact object itself with `head-object` / `cp` and grep that.
- Hashes are **not comparable** across `describe-state-machine` output (the CLI reformats). Compare decisive markers — `StartAt`, the count of a distinctive key — not hashes.

## Environment facts
| | staging | production |
|---|---|---|
| AWS account | 996629427160 | 653055222572 |
| GitLab environment / ref | `staging_next_actions`, from `main` | `production_next_actions`, from a release tag |
| Deploy trigger | automatic on `main` | release pipeline only (`if $CI_COMMIT_TAG`) |
| AWS profile | `staging-voiceai` | `production-voiceai` |

Both profiles use aws-vault with SSO. Artifact bucket: `shared-pdx-809849379942-artifacts`.

**CI race (staging was one commit behind).** Two pipelines on `main` can run at once. `resource_group` serialises jobs by arrival, not by commit age, and `.sam-deploy` in the remote template is `interruptible: false`. So an older queued deploy can land **after** a newer one, silently leaving the environment on the older commit. There is no `auto_cancel`. A green pipeline is not proof of a deployed commit.

## The migration engine
- A **wave** is a worklist — a list of companies to move. The catalogue table (`<env>-next-actions-migration-catalogue`) is the per-company notebook of state.
- Statuses are exactly `migrating | migrated | failed`. There is **no `pending`** in the schema.
- `region` on a row is the routing pin — what `resolveCompanyRegion.ts` reads at request time.
- While `migrating`, reads stay on the source and the write gate blocks writes.
- The state machine (ASL) waits 3600s of "soak" after Flip before reclaiming (deleting) the source.
- Worklist entry fields: `companyId`, `region` (**the TARGET**), optional `sourceRegion` (where the data lives). Omitted `sourceRegion` defaults to the default region `us-west-2` — which, for a reverse wave, is a silent no-op skip.

## Directed reverse waves (the APR-7618 change)
A wave is "directed" when it moves a company **into** the default region: source `eu-central-1` (FRA) → target `us-west-2` (PDX). The LATAM production worklists (`latam-fra-pdx-w{0,1,2}.json`) set `sourceRegion` explicitly. (Wave contents and canary: see the OpenSpec change and the worklist files.)

## THE DANGEROUS PRECONDITION
> A catalogue row with `status: migrated` and **no `region`** field (a legacy row from an earlier forward wave) makes a reverse wave go `Init → MigrationAlreadyMigratedError → Soak → DeleteSource`. The reclaim guard is **bypassed** because the row has no `region` — **it deletes source data without copying it.**

The safe pre-state for a reverse wave is an **ABSENT catalogue row**. Do not hand-write a status row; `pending` is not a real status. The Lambda-side guard only protects a **present** `region`, and the ASL predicate `$.region == $.sourceRegion` only compares execution inputs — neither catches a legacy row.

## Staging rehearsal of FRA→PDX
Company: **306542** (`STAGING_COMPANY_IDS` in `src/domain/valueObject/latamMisHomedCompanyIds.ts`).

Worklist file to create: `migration-worklists/staging/latam-fra-pdx-w0.json`

```json
[{"companyId":306542,"sourceRegion":"eu-central-1","region":"us-west-2"}]
```

`start-execution` input shape: `{"key":"migration/<wave>.json"}`.

Steps (ordered):
1. **Verify where the data actually lives** — bastion SQL (host `shared-services`; queries in `docs/runbooks/region-misroute-reconcile.md`). *Human / DB access.*
2. **Delete the catalogue item** for 306542 so the row is absent. *Write, needs authorisation.*
3. **Upload the worklist** to `migration-worklists/staging/latam-fra-pdx-w0.json`.
4. **ONE `start-execution`** with `{"key":"migration/latam-fra-pdx-w0.json"}`. *Write, needs authorisation.*
5. **Verify Flip**: the row is `migrated` with `region=us-west-2`, and row counts on the target match the source.
6. **Wait the hour**, then verify reclaim (source deleted).

Traps:
- A currently-present row makes the run delete without copying (see above).
- A second execution goes down the reclaim route.
- Omitting `sourceRegion` silently skips the copy.
- A wrong-direction row is refused on purpose.
- The soak cannot be shortened.
- The company is unwritable while migrating.

## Docs that lie
- `src/migration/README.md` is stale: it claims there is no `failed` status and describes resetting to `pending`. Trust the schema and the ASL, not the README.
- `migration-worklists/README.md` says GDS flips before the waves while the OpenSpec design says after — an unresolved conflict, not settled.

## Verification surfaces
- Log groups: `/aws/vendedlogs/states/<env>-next-actions-migrate-{cohort,company}`, `/aws/lambda/<env>-next-actions-migrate-*`.
- The migration catalogue table (per-company rows).
- The cohort state machine **tolerates failed children**: a `SUCCEEDED` cohort status is NOT proof of success. Check every company's row.

## Open items
- CI race fix not done: a pre-deploy guard comparing `CI_COMMIT_SHA` against current `main` HEAD.
- A green pipeline does not mean the environment runs that commit.
