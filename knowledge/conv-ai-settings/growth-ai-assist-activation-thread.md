# Growth AI Assist activation thread

## Channel and thread

Slack channel: `#proj-ai-assist-activation` (ID `C0BL6L1MGP7`). The thread parent message (`1790342757.293829`) was started by Joel Armada on 2026-09-25. Pablo Albaladejo replied on 2026-09-28.

## Participants

- Joel Armada — Senior SWE; owns the AI Settings default rollout for US/CA.
- Pablo Albaladejo — owner of conv-ai-settings.
- Manuel Ventero — EM; calls the team “growth”.
- Nestor Pina Fernandez — Engineering Director; storage ownership.
- Paul Genix — PM intern, cc'd only.

## What growth asked

Joel announced AI Settings active by default for the first line of US/CA companies. It was deployed and tested on staging, with production planned by the end of the following week.

Manuel asked why onboarding appeared on workspace instead of dashboard. The answer was that the personalization flow is mandatory, admin-only, and present on both surfaces. His open question was, “thoughts on trying to pull company context here? It'd be awesome as we push for more proactive experiences”. He pressed again that this is the most important thing for AI products cold-start IMO.

Manuel listed the fields growth uses today for AIVA, MAIA and Assist: company description, products and services, and keyterms. They are used to improve transcript quality and AI insights.

Nestor asked where the collected URL should be sent, floated core-kb, asked whether an internal API exists and whether it would trigger a background job, and stated the constraint that storage must live outside their own services so the company-context concept stops being duplicated everywhere.

## What we offered

The following reflects what Pablo sent in the reply:

- conv-ai-settings is the service (Manuel had already said this; the reply confirms it).
- `POST /v1/companies/{companyId}/context/generate-from-url` is internal, with IAM authorization plus account allowlist. Send a URL; scrape with Firecrawl; extract with Azure OpenAI; context is streamed back in the same call. No job is queued.
- `GET /v1/companies/{companyId}/context` has the same auth and returns stored context plus a `formattedContext` ready to drop into a prompt. Custom insights and conversation insights already call it.
- Fields today: `description` and `products`. `keyterms` was stated as landing that week. This claim was made deliberately by Pablo in the message.
- The async half was described as built: it reacts to `user_created` and prefills on its own. Its shape is generic and can be pointed at any other dataplatform event growth needs. The reply deliberately omitted a “switched off” qualifier, by Pablo's decision.
- Email-domain inference was described as best effort: if the company name is known, use it; otherwise infer the URL from the email, and only when the domain is not a generic one.
- Storage: there was still no shared place outside conv-ai-settings; context lived in the service's own tables. Nestor's constraint remained open.

## Verified repo state and gaps

These are the verified repo facts at the time of writing, and gaps against the message:

- `PREFILL_GENERATION_ENABLED` defaults to `false` in the `user_created` SQS handler; the prefill path exists in code and is off.
- `company-context/AGENTS.md` records that MR 185 (APR-7525) must land and merge before `PREFILL_GENERATION_ENABLED` is ever set to `true` anywhere it reaches real traffic, because Firecrawl still logs the scraped URL. MR 185 is closed, not merged.
- The SQS event-source mapping is not present in the checked-in SAM templates, so the consumer should not be presented as wired. `company-context/AGENTS.md` says that mapping is owned elsewhere.
- The extraction contract is `description` (max 500 chars) and `products` (max 2500); keyterms are not produced today in `generate-from-markdown` nor stored.
- The `activation` domain's company-context generation, save, license and activation writes are canned in every environment, including production. There is no flag that makes them live; swapping the adapter is the rollout mechanism. Any claim about context generation inside the activation wizard is not backed by live behaviour.
- Published states are only `on` and `off`; the internal REST reader suppresses missing or `off` rows. `deleteCompanyContext` is a success-shaped no-op; it does not delete.
- The wizard lifecycle (lock, steps, teams, release) is genuinely live on DynamoDB.

## Plan context

For orientation:

- The “v2 plan” is Story APR-7729, “AI Assist Activation wizard — V2” (To Do), with 33 children ordered in 5 waves written into the ticket body: W1 custom vocabulary, W2 company context, W3 cheap local fillers, W4 production/public contracts, W5 cross-repo S2S. There is no epic for it and no PRD named “Company Context V2”. APR-7729 is the delivery order; an engineering Map page and Manuel's RFC “Company Context Knowledge Graph” (Crawl/Walk/Run/Fly) are the direction documents.
- Every open ticket in that plan is assigned to Pablo Albaladejo, including Wave 5 S2S story APR-7732, whose own body says it needs its own owner.
- Prefill chain shipped as Done: APR-7528, 7529, 7530, 7531, 7532, under umbrella APR-7094. APR-7602 is a non-code gate on enabling prefill in production and needs an answer from data-platform on a spend cap and alarm destination.
- APR-7238 (context history with restore) has the revision envelope and latest-revision reads built; history and restore do not exist. APR-7095 (richer profile: competitors, domainKeywords, suggestedVocabulary, vertical, communicationLanguage) is not built.

## Open

- Nestor's storage question: no shared place outside the service; core-kb is not a company-context store in this repo.
- Whether keyterms really landed that week; the reply asserts it.
- Whether the SQS event source is wired anywhere external.
- MR 185 (APR-7525) precondition, still unmet in `main`.
- Email-domain inference had not been started at the time of the note; Manuel described it as something “we're now going to test”.

Sources: Slack thread `1790342757.293829`; `company-context/AGENTS.md`.
