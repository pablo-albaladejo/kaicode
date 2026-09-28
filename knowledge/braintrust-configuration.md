# SNS LLM-result topic: who publishes, and why conv-ai-settings has no entry in the topic policy

Measured 2026-09-25. Cross-repo configuration: `conv-ai-settings` (publisher), `conversation-ai-monitoring` (topic) and the per-environment "shared account". Not derivable from `conv-ai-settings` alone.

**No credential value appears in this file.** Only ARNs, account ids, role names, policy statement ids and parameter names.

## The one-line answer

conv-ai-settings publishes to the conversation-ai-monitoring LLM-result SNS topic from its own AWS account, using a `sns:Publish` grant on its own Lambda role. The topic's resource policy does not name conv-ai-settings, and it is not supposed to: the resource policy exists for a *cross-account* publisher (the "shared account"), and same-account publishers are allowed by their identity-based policy. Verified: the staging app role simulates `allowed`.

## Topic ARNs, one per environment

From `.sam-envs/<env>` in the conv-ai-settings repo, added by commit a2d7c41d.

| env | topic ARN |
|---|---|
| sandbox | `arn:aws:sns:us-west-2:414059859629:sandbox-conversation-ai-monitoring-llm-result` |
| staging | `arn:aws:sns:us-west-2:996629427160:staging-conversation-ai-monitoring-llm-result` |
| production | `arn:aws:sns:us-west-2:653055222572:production-conversation-ai-monitoring-llm-result` |

All region us-west-2. The owner of each topic is the account in its own ARN: each environment has its own topic in its own account, one per env, not one shared.

## The topic resource policy

Each topic carries exactly one statement: `Allow`, action `sns:Publish`, resource the topic itself, no `Condition`, no wildcard principal. The principal differs per environment and is the "shared account" of that environment.

| env | principal in the topic policy |
|---|---|
| sandbox | `arn:aws:iam::414059859629:root` |
| staging | `arn:aws:iam::886862221201:root` |
| production | `arn:aws:iam::555773567328:root` |

The sandbox principal is that topic's own account, so the "shared account" is a per-environment parameter (`SharedAccountId`) in conversation-ai-monitoring's `template-event-subscription.yaml`.

## Why conv-ai-settings has no entry in the topic policy

The grant lives in the Lambda's own role. `template-company-context-app.yaml` declares an inline policy `LlmResultPublish` (`sns:Publish` on `!Ref LlmResultSnsTopicArn`), gated on `HasLlmResultTopic`; `template-company-context-frontend-api.yaml` declares the equivalent for the frontend lambdas. Verified in staging: `aws iam simulate-principal-policy` for role `pdx-staging-conv-ai-settings-cc-app-role`, action `sns:Publish`, resource the staging topic ARN → `allowed`, matched statement `role_pdx-staging-conv-ai-settings-cc-app-role_LlmResultPublish`.

## Other publishers on the same staging topic

Measured: 13 Lambdas in account 996629427160 name the staging topic in their settings — conv-ai-settings ×2, custom-insights ×3, next-actions ×4, playbook-assistant ×2, conversation-coaching, realtime-question-answering. None of them appears in the topic policy; they are all same-account and follow the same pattern as conv-ai-settings.

## Production is not misconfigured, it is not deployed yet

The production conv-ai-settings stack still carries `LlmResultSnsTopicArn: ""` and was last updated before a2d7c41d landed. With an empty ARN the publisher deliberately skips the call and logs the drop reason `no-topic-configured` (`src/domains/shared/infrastructure/services/publish-llm-result-service.ts`). So production publishing is *never attempted* rather than failing; it starts once a production deploy includes a2d7c41d. A `simulate-principal-policy` against the production role returns `implicitDeny`, which is the expected consequence of the empty parameter, not a broken permission.

## Two AWS measurement gotchas found the hard way

- `AWS/SNS NumberOfMessagesPublished` must be dimensioned by `TopicName`, not `TopicArn`. With the `TopicArn` dimension the query returns an empty datapoint set, which reads as "nothing was ever published" when in fact the staging topic had **51,576 messages in 30 days**. Do not write a full ARN as a `TopicName` value either — that also returns nothing.
- `aws iam simulate-principal-policy` must be given the role that actually carries the grant. The role attached to a Lambda's configuration is not always the one holding the inline policy; simulating the wrong role returns `implicitDeny` and a false "misconfiguration" conclusion.

## Dropped-event signal to look for

The publisher logs `llm_result_event_dropped` with a reason (`no-topic-configured` is one). In staging, `/aws/lambda/staging-conv-ai-settings-cc-fe-gen-from-url` and the `cc-app` lambdas are where a publish originates.

## Not checked

- A real staging publish originating from a conv-ai-settings Lambda: the simulation says `allowed`, the traffic measured on the topic is not attributable to our service specifically. To settle it, run one generate-from-url in staging and check the topic's message count rises while no `llm_result_event_dropped` appears.
- `aircall/voiceai/custom-summaries` does not exist (404, and `projects?search=custom-summaries` returns 0 results). The service meant is presumably custom-insights, whose role follows the identical pattern (its staging role also simulates `allowed`).
- CloudTrail SNS Publish events were not read.

## Why this lives here

Kept in the knowledge base by explicit request: this is cross-repo configuration (conv-ai-settings + conversation-ai-monitoring + the shared account) and is not derivable from conv-ai-settings alone.
