# RudderStack: producers, clients and credentials — cross-repo inventory

Measured 2026-09-25. Covers every repo under the `~/development` tree plus the deployed AWS accounts. Companion to the RFD *A producer-owned event contract for the datalake* (Confluence, space SC, page 5291474995, v3 2026-09-02), design APR-7455, implementation APR-7687 / MR !235.

**This file contains credential *identifiers* and SHA-256 fingerprints, never credential values.** Compare keys by re-hashing a value and matching the hash, never by pasting values into a traced session (all traffic here is traced into Langfuse).

## The one-line answer

Nobody publishes server-side events with a live key from `agent-chat-server` or `conv-ai-settings` — those two have the SDK deployed but **no credential configured in any environment**. The backend services that do have real keys today are `customer-provisioning` (sharing its key with `fraud-ai`), `cbe`, `customer-data-feeder`, `voice-virtual-agent` and `conductor`. Counting browser sources, there are **13 distinct keys across 19 labels**, one per environment, and no key crosses environments.

## Reverse index — 13 distinct keys

Shared keys:

| # | sha256 (full) | shared by |
|---|---|---|
| 1 | 2b0786ddd8424b501cc54e032bf88c60575497cbee674e9b73faffeb7814adb8 | `customer-provisioning` staging · `fraud-ai` staging |
| 2 | 0447b6b5de22d25bbdfd14e3c9fe2f1a69b03012fe8b8b67823d991ba0f79ba5 | `customer-provisioning` production · `fraud-ai` production |
| 3 | 8271de9599a84a4bf8c5aa2dfd84f944a12a1a224c68832db29fc1e8995f6d75 | `clients` staging · `aw-web` test · `phone` staging |
| 4 | 0bebd74aacdb6a4463b2c3476a6cba8556183c6a5bf23987a134255289119dee | `clients` production · `phone` production |

Single-owner keys:

| # | sha256 (full) | owner |
|---|---|---|
| 5 | 839f250f534d5503a00e1d7314d56c47c12c8de69732274e3830aae3e57e619e | `dashboard` staging |
| 6 | 2b9ae8486a8b6b0e9918680d42336190fd86c31b134afdbf50cf04c89a0f58b4 | `dashboard` production |
| 7 | 8bf6170b52a798e84778c6973e30f9620901c598678cd0fa34c38e85fcb94692 | `cbe` staging |
| 8 | da4511637f12860821384d5fd5d08d18a774c7eaa1f4c0f0f6a2cb971ed064f4 | `cbe` production |
| 9 | 8cdf3d1b9d358698e1d3c4f42ea4511c3b8ce6af6a8a55ca95a3a65027e4b375 | `aw-web` staging |
| 10 | e8138674fe69186bc0abbffa973e1f5b28e3c344e86866005f98f0ca0a0b8559 | `aw-web` production |
| 11 | 5b93a9fd7244ac4730cee605dd3e7f8218055c736a85f1da12b789770216e0b1 | `customer-data-feeder` |
| 12 | 652ee312cf1156730e65fdc48f70f8e76e8f54ac2af921d832c8e69982c204eb | `voice-virtual-agent` (inner JSON field `api_key`) |
| 13 | ed04c502fc2b54d117ca7a3dc7dd770eb6577cebcd3bed7518c6399ac942b8df | `conductor` staging |

Undetermined: `conductor` production — `AccessDeniedException` on `GetSecretValue` with the available profiles.

All values are 27 characters long, the RudderStack write-key format.

## Producers, forward view

| producer | client | credential location | init / entry point |
|---|---|---|---|
| `customer-provisioning` | `@rudderstack/rudder-sdk-node` `^2.0.7`, direct, locked 2.0.7 | SSM `/{staging,production}/customer-provisioning/rudderstack/write_key`, bare key, `--with-decryption` | `new RudderAnalytics(writeKey, { dataPlaneUrl })` — `adapters/repositories/rudderstackApi.ts:16`; send at `adapters/rudderstack/index.ts:38`. Callers: processout webhook, celigo subscriptions webhook, `companies/features/subscribeFeatures`, `companies/discount`. Events: `churn_request_pending_approval`, `churn_request_approved`, `churn_request_cancelled`, `self_subscription_payment_failed`, `self_cancellation_discount_completed`, `self_subscribe_addon` |
| `fraud-ai` | — | SSM `/{staging,production}/fraud-ai/rudderstack/write_key` — **same key as `customer-provisioning` in each environment**, so the same RudderStack source | — |
| `cbe` | — | SSM `/{staging,production}/cbe/rudderstack/api_key` | — |
| `customer-data-feeder` | — | Secrets Manager `/service/customer-data-feeder/rudderstack-api-key` (readable in 886862221201 only) | — |
| `voice-virtual-agent` | — | Secrets Manager `/service/voice-virtual-agent/rudderstack-api-key`, JSON with field `api_key` (readable in 886862221201 only) | — |
| `conductor` | — | Secrets Manager `/service/conductor/{staging,production}-rudderstack-write-key` (staging readable; production access denied) | — |
| `dashboard` (browser) | `@aircall/tracker` `^3.7.0` direct in `dashboard-v4`; the extensions construct no client at all and borrow the host's | SSM `/{staging,production}/dashboard/rudderstack_api_key` — **one shared param per environment**, injected by `repository-mgmt` as `RUDDERSTACK_API_KEY` into ~22 apps (`dashboard_v4`, `assets_page`, `authentication_ui`, and the extension set: account, agent_productivity, analytics, calendar_mgmt, call_timeline, campaign, conversation_center, flow_editor, integration, knowledge_base, live_feed, messaging, number, team, user, voice_virtual_agent). `staging-verizon` reuses the staging param | `new Tracker({ key })` — `dashboard-v4/src/constants/tracker.constants.ts:5-6` |
| `clients` (browser) | — | SSM `/{staging,production}/clients/rudderstack/api_key` — the same key the browser extensions and phone use under test | — |
| `aw-web` (hydra, browser) | `@rudderstack/analytics-js` `3.22.0` direct in `packages/tracker`; `@aircall/tracker` `3.7.5` in `packages/track-domains` | **committed in plain text**: `VITE_PUBLIC_RUDDERSTACK_TOKEN` in `hydra/apps/aw-web/env/.env.staging:7` and `.env.production:7`, plus `hydra/apps/aw-web/.env.test:7`. Not the dashboard param — aw-web never reads it | `new RudderAnalytics()` then `.load(key, dataPlaneUrl, …)` — `hydra/packages/tracker/src/Tracker.ts:102` and `:109`; reads `RUDDERSTACK_TOKEN` at `hydra/apps/aw-web/env.ts:53` |
| `phone` (hydra, browser; standalone `phone` repo is deprecated) | `@aircall/tracker` `3.2.1` direct, which brings `rudder-sdk-js` `2.26.0` **transitively**; also pins `analytics-js-service-worker` `3.3.0` | **committed in plain text**: `hydra/apps/phone/.env.staging:34`, `.env.production:34`, env var `REACT_APP_RUDDERSTACK_API_KEY` | `new Tracker({ key: process.env.REACT_APP_RUDDERSTACK_API_KEY })` — `phone/src/lib/tracker.ts:3-4` |

## Code exists but no key is configured

- `agent-chat-server` — `@rudderstack/rudder-sdk-node` `^2.1.11` (direct, locked 2.1.11), `src/infrastructure/services/rudderstack-tracker.ts:32` (`new RudderAnalytics(writeKey, { dataPlaneUrl, flushAt: 1 })`), wired in the AppSync `app.ts` and `entry-points/api-gateway/lambda/shared/create-chat-app.ts`. Events `Analytics Assistant Message Sent`, `Analytics Assistant Feedback Submitted`. **But `RudderstackWriteKeySecretArn` is `''` on the sandbox, staging and production stacks, and `RUDDERSTACK_WRITE_KEY_SECRET_ARN` is absent from all 16 Lambdas.** The `HasRudderstackSecret` gate (`template-api.yaml:112`) therefore takes the empty-ARN branch and the tracker is a no-op. The SDK is deployed; the events are not flowing.
- `conv-ai-settings` activation — worktree APR-7687 only, `src/domains/activation/infrastructure/analytics/`, `new RudderAnalytics(writeKey, {…})` at `src/domains/shared/infrastructure/services/publish-analytics-event-service.ts:77`, events `activation_settings_proposed` / `activation_settings_confirmed`, off by default. `ActivationAnalyticsWriteKeySecretArn` is `''` and `ActivationAnalyticsEnabled=false`. In the worktree the package is declared in **both `dependencies` and `devDependencies`** — looks like a merge error; `knip` will not catch it. Not merged.

## Consumers, not producers

- `data-intelligence-infra` — the `datalake_rudderstack` Terraform module (S3 bucket + Glue DB + Lake Formation) and the Firehose flatten script. RudderStack writes the sink; there is no SDK on our side.
- `data-platform` — `rudderstack_events_settings`, phone-event ingestion via RudderStack to Kinesis/S3.
- `repository-mgmt` — pure Terraform, no client: provisions the dashboard SSM params and injects them into the browser apps.

## Not producers

`internal-api`, `next-actions`, `conversation-center`, `conversation-coaching`, `conversation-insights`, `call-service`, `realtime-question-answering`, `realtime-transcriber`, `transcription-settings`, `playbook-assistant`, `flow-manager`, `ai-mastermind`, `webhook-engine`, `pulse`, `alerts`, `global-data`, `web` — no RudderStack, no analytics SDK. `automated-tasks` matched only through cached copies of other repos' source; `onboarding` through one task-note line.

## Environments and accounts (all `us-west-2`)

| purpose | aws-vault profile | account |
|---|---|---|
| staging | `staging-architecture` | 886862221201 |
| production | `conversation-ai-prod` | 555773567328 |
| conductor staging | `staging-voiceai` | 996629427160 |
| conductor production | `production-voiceai` | 653055222572 |

`customer-provisioning`'s committed `/sandbox/…` and `/qa/…` paths are **not present in any of the 8 reachable accounts**.

## Method — so the numbers can be reproduced

- Hashes are SHA-256 of the exact value with surrounding quotes stripped and trailing newline removed, so committed `.env` literals are comparable with SSM values. For a JSON-shaped secret the **inner** field is hashed (`api_key` for `voice-virtual-agent`), never the wrapper. To check a claim: read the value, normalize it the same way, re-hash, compare. Do not paste values anywhere traced.
- `aws secretsmanager list-secrets` and `aws ssm describe-parameters` must be run **unfiltered** — an earlier filter on `rudder` returned nothing and produced a false "these secrets do not exist".
- Derive credential identifiers from the deployment (`aws lambda get-function-configuration`, `aws cloudformation describe-stacks` reading `Parameters`), not from the repo alone: `agent-chat-server`'s ARN is `Default: ''` in the template and absent from `.sam-envs/*`.

## Open items

- `conductor` production key unread (`AccessDeniedException`), so conductor staging vs production is unproven.
- `customer-data-feeder` and `voice-virtual-agent` are readable in the staging account only (`AccessDeniedException` in the production account); whether they have production counterparts is unknown.
- The RFD's open question 6 asks which backend services publish server-side today; this file answers it, but the RFD itself names neither `agent-chat-server` nor `customer-provisioning`, and it calls `rudderstack_commerce_platform_server` "only a name in a provisioning table" — `customer-provisioning` is a real publisher behind that namespace.
- The namespace-to-key mapping is not recorded in any repo; RudderStack's own configuration is out of band. Grouping here is by observed hash equality, which is stronger than by namespace name.
