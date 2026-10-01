# Email Integration Spec

Status: **sending (SES) and receiving (IMAP) are both implemented**, but via different mechanisms than §5 originally recommended — see the note at the top of §5 before reading it as a plan rather than a decision record. **SES's own event ingestion is not built** — §3's SNS pipeline and the `EmailEvent` model remain unbuilt, so a message we sent still only ever reaches `EmailMessage.status: "sent"` (what SES accepted at send time) or `"failed"` (what our own queue gave up on); nothing yet tells us from SES whether it was actually `delivered`/`bounced`/`complained` — only via IMAP, if it happens to also pass back through the synced mailbox. This covers sending/receiving email through AWS SES + IMAP and how it plugs into the existing `Contact` / `Deal` / `Activity` data model (see [SPEC.md](./SPEC.md), [CLAUDE.md](./CLAUDE.md)). Several points below are genuine tradeoffs rather than clear-cut defaults — they're marked **⚠ Decision needed** and summarized again in §8.

## 1. SES v2 API vs. SMTP

**Decision: use the SES v2 API via `@aws-sdk/client-sesv2`, not the SMTP endpoint.**

Reasons:
- **Auth is the same either way.** SMTP credentials are themselves derived from an IAM user/role's SES permissions — you don't avoid IAM by choosing SMTP. So "simpler auth" isn't a real argument for SMTP here; we're an AWS SDK consumer no matter which transport we pick.
- **Structured, synchronous responses.** `SendEmailCommand` returns `{ MessageId }` directly in the API response, which we need immediately to write `EmailMessage.sesMessageId` before any event ever arrives (see §4). Over SMTP you'd parse `MessageId` out of the `250` response text, which is uglier and provider-specific.
- **Native configuration-set / tag support.** The v2 API takes `ConfigurationSetName` and `EmailTags` as first-class request fields. Over SMTP you'd set these via `X-SES-CONFIGURATION-SET` / `X-SES-MESSAGE-TAGS` headers — it works, but it's header-string-building instead of typed fields, and easier to get subtly wrong (e.g. tag value encoding).
- **Retry/backoff is handled by the SDK**, consistent with how we already use `@aws-sdk`-style clients elsewhere... except we don't, yet — this is a new dependency either way. That's a fair cost to flag: today the app has zero AWS dependencies (Postgres is self-hosted/Render, not RDS; hosting is Vercel/Render per SPEC.md). Adding `@aws-sdk/client-sesv2` is the first AWS coupling in the stack.
- **No separate credential type to rotate.** SES SMTP credentials are a distinct derived secret (a username/password pair computed from an IAM secret key via a signing algorithm) that you generate once and store separately from your IAM access key. That's one more secret in `server/.env` with its own rotation story. The API just uses the IAM access key directly (or better, an IAM role if we ever run on infrastructure that supports it).

**The case for SMTP, briefly, so it's not silently dismissed:** if the team ever wants to swap mail providers (SES → Postgres... no — SES → Mailgun/SendGrid/etc.) without code changes, SMTP is the portable interface — point `nodemailer` at a different host/port/credential and you're done, no code touching provider-specific SDKs. The API route ties the codebase to SES's request/response shape. Given this app has no multi-provider ambition today and we're already accepting an AWS dependency for inbound (see §5), that portability doesn't buy us much right now — but if "don't get locked into SES" becomes a real requirement, revisit this.

## 2. Identity Model

**What we verify:**
- A **dedicated sending subdomain** (e.g. `mail.simplycrm.app`), not the organization's apex domain. Email reputation (bounce/complaint rate) is tracked per sending domain; isolating it on a subdomain means a bad sending period never touches deliverability for `@simplycrm.app` marketing/support mail or anything else on the root domain.
- DNS verification via **Easy DKIM** (SES-provided CNAME records, auto-rotated) rather than bringing our own DKIM keys — less to manage, and SES rotates the keys for us.
- SPF via the `include:amazonses.com` mechanism on the subdomain, and a DMARC record (`p=quarantine` to start, not `p=reject`, until we trust our own sending hygiene) on the subdomain.
- We verify the **domain**, not individual mailbox addresses. Domain verification lets us send from any address `@mail.simplycrm.app` (e.g. per-user `jordan@mail.simplycrm.app`, or a single `notifications@mail.simplycrm.app`) without a separate verification step per address.

**⚠ Decision needed — reply-to address shape.** Do reps send as themselves (`jordan@mail.simplycrm.app`) or does all CRM mail go from one shared address (`notifications@mail.simplycrm.app`) with `Reply-To` set to the rep? Per-user addresses feel more personal but mean every team member change (new hire, rename) touches DNS-adjacent config; a shared sending address with per-thread `Reply-To: reply+<token>@mail.simplycrm.app` is simpler to operate and is what §5's inbound design assumes below. Defaulting to the shared-address model; flagging because it's a product call, not just an infra one.

**Sandbox vs. production:**
- New SES accounts start in the **sandbox**: you can only send *to* verified identities (individual addresses or domains you've explicitly verified as recipients), and are capped at **200 messages/24h** and **1 msg/sec**. This is a hard blocker for anything beyond internal testing — a CRM where a user types in an arbitrary prospect's email address will fail every send until we're out of sandbox.
- **Production access** is requested via an AWS Support case (Service Quotas → "SES Sending Limits"), not automatic. AWS asks for: what you're sending (transactional CRM mail, not bulk marketing), how you handle bounces/complaints (→ point at §3/§4's event pipeline as the answer), how you collect recipient consent, and an estimated volume. Budget for **this taking from a few hours to a few business days** — it's manual review, not an API call. This needs to happen well before any real-user demo, not the week of.
- Until production access is granted, **seed/dev/staging environments should stay in the sandbox deliberately** (verify the team's own addresses as test recipients) rather than rushing production access onto a non-prod AWS account — keeps the blast radius of a sending bug contained.

## 3. Configuration Sets & Event Destinations

One configuration set, e.g. `simplycrm-transactional`, attached to every send (`ConfigurationSetName` on the `SendEmailCommand`). It has one **event destination** of type SNS, subscribed to exactly the events we act on:

| Event | Why we want it |
|---|---|
| `Send` | SES accepted the message for delivery attempt. First state transition for `EmailMessage.status`. |
| `Delivery` | Accepted by the recipient's mail server. Marks the message delivered; what most of the UI should treat as "sent successfully." |
| `Bounce` | Recipient address rejected it (hard/soft). Distinguish `bounceType: Permanent` (bad address — stop sending to it) from `Transient` (mailbox full, etc. — may succeed later) using the event payload; see §4 on not over-normalizing this into columns yet. |
| `Complaint` | Recipient hit "mark as spam." Treat as equivalent-or-worse than a hard bounce for suppression purposes. |
| `Reject` | SES itself refused to send (e.g. it decided the content looked like a virus). Rare, but silent failure here would be confusing — a contact just never gets email and we'd have no record why. |
| `DeliveryDelay` | Temporary delivery failure, SES is still retrying. Useful to surface "this is taking a while" in the UI rather than nothing. |

Deliberately **not** subscribing to `Open`/`Click` — they require a separate SES feature (and for click tracking, link rewriting), they're a privacy-sensitive data point for a product that didn't ask for engagement analytics, and most opens are confounded by mail-client image prefetching anyway. Leaving this out is a scope choice, flagged in case a future "did they read it" feature is wanted.

**⚠ Decision needed — SNS → app delivery mechanism.** Two reasonable shapes:

1. **SNS → HTTPS endpoint directly** (e.g. `POST /api/webhooks/ses`). Simplest to stand up — one Express route, verify the SNS message signature, handle the subscription-confirmation handshake once. But: SNS retries a failing HTTPS endpoint for a limited window (minutes, with backoff) and then drops the notification; if our app is redeploying or the DB is briefly down during a bounce storm, we silently lose events.
2. **SNS → SQS → a worker that polls the queue.** Adds an SQS queue and a small poller process, but decouples ingestion from processing: a slow DB write or a deploy doesn't drop anything, since messages sit in the queue until acked, and we get natural retry/backoff and a dead-letter queue for events we can't process after N attempts.

Given this app already has no background-worker infrastructure (no job queue exists today — everything is request/response Express), option 1 is less new infrastructure to stand up and is probably the right **starting point** for the current scale (small team, modest send volume). Option 2 is the more correct answer once bounce volume or reliability requirements grow, or once we're also running inbound (§5) through the same kind of pipeline and a worker process is being stood up anyway — at that point, route both through the same SQS-backed worker rather than keeping inbound on a queue and outbound events on a raw webhook. Recommending **start with (1), revisit (2) when inbound ships**, but this is a real "how much infra do we want to operate" tradeoff, not a technical slam-dunk either way.

Either way: verify the SNS message signature (`sns-validator` or manual SigV4-adjacent signature check) before trusting payload contents — this endpoint is public by necessity (SNS calls it over plain HTTPS, no IAM), so signature verification is the only thing standing between us and a spoofed bounce event.

## 4. Schema

New Prisma models, following existing conventions (UUID ids, camelCase fields mapped to `snake_case` columns, `onDelete: SetNull` on optional FKs).

### EmailThread
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| contactId | UUID | FK → Contact, nullable |
| dealId | UUID | FK → Deal, nullable |
| subject | string | normalized subject (①`Re:`/`Fwd:` prefixes stripped for grouping, raw subject kept on individual messages) |
| lastMessageAt | timestamp | denormalized for cheap "most recent thread" sorting without aggregating `EmailMessage` every list render |
| createdAt | timestamp | |

### EmailMessage
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| threadId | UUID | FK → EmailThread |
| contactId | UUID | FK → Contact, nullable — denormalized from the thread for direct querying ("all email for this contact") without a join |
| dealId | UUID | FK → Deal, nullable, same reasoning |
| direction | enum(`outbound`, `inbound`) | |
| authorId | UUID | FK → User, nullable — who sent it (null for inbound) |
| sesMessageId | string | nullable, **unique** — the `MessageId` SES's API returns synchronously on send. See correlation note below. |
| rfc822MessageId | string | nullable, unique — the RFC 5322 `Message-ID:` header value. **Not the same string as `sesMessageId`** — see below. |
| inReplyTo | string | nullable — the `In-Reply-To:` header of this message, used to resolve threading on inbound mail |
| fromAddress | string | |
| toAddresses | string[] | Postgres text array; fine at CRM scale, no need for a join table |
| subject | string | raw, un-normalized |
| bodyText | text | nullable |
| bodyHtml | text | nullable |
| s3ObjectKey | string | nullable — set for inbound messages where SES wrote the raw MIME to S3 (§5); outbound bodies are generated by us so we don't need to re-fetch them from anywhere. **Not yet used** — no inbound pipeline exists yet. |
| status | enum(`queued`, `sending`, `sent`, `delivered`, `bounced`, `complained`, `failed`) | Doubles as **queue state**, not just a status snapshot — see §4a. `delivered`/`bounced`/`complained` are reachable in principle but nothing sets them yet (that's the unbuilt event pipeline, §3). |
| attempts | int | Send attempts so far, incremented each time the queue worker tries. See §4a. |
| nextAttemptAt | timestamp | nullable — when the queue worker should retry next, for backoff. Null means "due now." |
| lastError | string | nullable — the most recent send error, whether or not it ended up retried. Surfaced in the UI; see §4a. |
| createdAt / updatedAt | timestamp | |
| sentAt | timestamp | nullable |

### EmailAttachment
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| emailMessageId | UUID | FK → EmailMessage, cascade-deletes with the message |
| filename | string | |
| contentType | string | |
| data | bytes | Raw bytes, stored directly in Postgres. ⚠ **Judgment call**: no file-storage infra exists in this app (SPEC.md §1), and attachments are capped well under SES's 10MB message ceiling (see §4a), so Postgres `bytea` is the pragmatic choice for now over standing up S3 for this alone. Revisit if attachment volume/size becomes a real DB-size concern. |
| createdAt | timestamp | |

### EmailEvent
| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| emailMessageId | UUID | FK → EmailMessage, **nullable** |
| sesMessageId | string | kept here too, even though `emailMessageId` usually gives us this — see correlation note |
| type | enum(`send`, `delivery`, `bounce`, `complaint`, `reject`, `delivery_delay`) | |
| payload | jsonb | the raw SNS message body, verbatim — see note below |
| occurredAt | timestamp | from the event's own timestamp field, not our ingestion time |
| createdAt | timestamp | our ingestion time — kept separately from `occurredAt` since SNS delivery isn't instant |

**Why `EmailEvent.emailMessageId` is nullable:** if an event arrives for a `sesMessageId` we don't recognize (process restarted before we persisted the send record, a message sent outside our app during testing, a race between the send call and the webhook), we still want to store the raw event rather than drop it — reconciliation can happen later by re-matching on `sesMessageId`. Dropping events we can't immediately correlate would make bounce-handling silently lossy.

**Why `EmailEvent.payload` is a raw JSON blob instead of normalized columns (e.g. `bounceType`, `complaintFeedbackType`):** ⚠ **judgment call, reversible.** SES's bounce/complaint payloads have several sub-fields (`bounceType`/`bounceSubType`, `complaintFeedbackType`, diagnostic codes per recipient) that we don't have an immediate query need for beyond "is this a hard bounce." Storing the full JSON means we never lose data and can add normalized columns later via a backfill if a real reporting need shows up (e.g. "show bounce sub-type breakdown"). The cost is that ad-hoc SQL queries against bounce subtype require `payload->>'bounceType'` JSON operators instead of a plain column. If bounce/complaint reporting becomes a real feature, promote the handful of fields we actually filter/group by into real columns at that point.

**Correlating SES MessageIds back to our records — the part most likely to be gotten wrong:**

SES has **two different "message ID" concepts** that are easy to conflate:
1. The **API-level `MessageId`** returned synchronously by `SendEmailCommand`, and which also appears as `mail.messageId` in every event notification (`Send`, `Delivery`, `Bounce`, etc.) for that message. This is what we store as `EmailMessage.sesMessageId` and is the join key for incoming events: on every SNS notification, look up `EmailMessage` by `sesMessageId` to attach the event.
2. The **RFC 5322 `Message-ID:` email header** (`<abc123@mail.simplycrm.app>`), which is what mail clients use for threading via `In-Reply-To`/`References` headers. SES does **not** set this to the same value as its own `MessageId` unless you explicitly set the header yourself in a raw/MIME send. **We must set this header ourselves on every outbound send** (deterministically, e.g. `<msg-{ourUuid}@mail.simplycrm.app>`) rather than relying on whatever SES or the sending library defaults to — otherwise we can send a message correlated correctly to our own send-event pipeline (via `sesMessageId`) but unable to recognize a reply to it (because we never recorded the `Message-ID:` header the reply's `In-Reply-To:` is pointing at).

So: `sesMessageId` correlates **our send → SES's events** (API-level). `rfc822MessageId` correlates **our message → a reply to it** (header-level, used when resolving inbound mail to a thread in §5). Both are needed; they serve different parts of the pipeline and must not be assumed interchangeable.

**Integration with the existing `Activity` model:** `ActivityType` already has an `email` value (see `server/prisma/schema.prisma`). **Revised from the original plan**: a corresponding `Activity` row is only created for messages sent through our own compose/reply routes, where `authorId` is a real `User` — not for anything the IMAP sync worker discovers (§5), since `Activity.authorId` is required and there's no `User` to honestly attribute an inbound (or externally-sent-outbound) message to. Those are still fully visible via the Email section's thread view, which reads `EmailThread`/`EmailMessage` directly rather than going through `Activity` at all. `EmailMessage` is the detailed record (headers, body, delivery status); `Activity` is a timeline-summary projection of the subset of it that has a real author — don't force one for messages that don't.

## 4a. Sending: queue, retry, and rate limiting

Sends are queued, never fired inline from the request — the compose/reply routes (`server/src/routes/emailThreads.ts`) only ever create an `EmailMessage` row with `status: queued` and return immediately; a separate worker does the actual SES call.

**⚠ Judgment call: in-process, Postgres-backed queue, not a real job-queue library/SQS.** `server/src/lib/emailQueue.ts` is a `setInterval` poller in the same Node process as the API, claiming due `EmailMessage` rows directly from Postgres. This app has no background-worker infrastructure today (CLAUDE.md), runs as a single process, and send volume is modest — this is durable (a queued message survives a server restart; verified by killing and restarting the server mid-retry during implementation) without a new infra dependency. The real cost: it is **not safe across multiple app instances** as written — there's no cross-process row claiming (no `SELECT ... FOR UPDATE SKIP LOCKED` or equivalent), only an in-process `tickRunning` flag preventing overlap within one process. Horizontally scaling this app would need real row-level claiming or a move to a proper queue (this is the same fork in the road as §3's SNS→SQS question — once a worker process is being stood up for one, route both through it rather than building two different queue mechanisms).

**Crash-recovery, not just retry:** a message stuck in `sending` at process startup means the server died mid-call to SES — genuinely unknown whether SES accepted it first. The worker's startup sweep marks these `failed` with an explicit "verify manually" message rather than auto-resuming them, because retrying risks a duplicate email landing in a real prospect's inbox, which is worse than a delayed send. This is a deliberate asymmetry: we're willing to retry on uncertainty about *our own* request, never on uncertainty about whether it *already went out*.

**Retry classification** (`server/src/lib/emailRetry.ts`): only SES's `MessageRejected` and `AccountSuspendedException` are treated as permanent — everything else (throttling, other SES exceptions, network failures, unknown errors) is retried with **full-jitter exponential backoff** (`random(0, min(15min, 2s × 2^attempt))`, AWS's own recommended formula), capped at **8 attempts** before giving up. The attempt cap, not the error classification, is what actually stops "retry forever" — a `BadRequestException` (e.g., a malformed request on our side) will burn through all 8 attempts rather than fail fast, which is a real tradeoff: simpler and more uniform than hand-classifying every exception, but not the fastest possible failure for cases that will obviously never succeed.

**Rate limiting is read from the account, not hardcoded:** `server/src/lib/sesQuota.ts` calls `GetAccount` and paces the worker to `SendQuota.MaxSendRate` msg/sec (60s cache, falls back to the sandbox default of 1 msg/sec if AWS is unreachable or nothing's configured yet). Note: `GetSendQuota` — the call this is conceptually "using" — is a **SES v1** API action; on the v2 API this repo uses, that same `MaxSendRate` field comes back on `GetAccount` instead, so that's what's actually called (same situation as `GetAccountSendingEnabled` → `GetAccount.SendingEnabled` in the health check; see SETUP.md).

**Failure is always visible, never silent:** `lastError` is surfaced in the UI whenever it's set — including while a message is still `queued` and waiting on its next retry, not only once it reaches terminal `failed` — and the thread list polls while anything is in flight so a later failure shows up without the user reopening the panel.

## 5. Receiving Email: SES Inbound vs. IMAP — the real tradeoff

**Decision made: IMAP (§5a), not SES inbound.** This section was originally written recommending SES inbound as the v1 scope, with IMAP as a larger, separate future feature — the analysis below is kept as the decision record (it's still accurate about what each option is/isn't good for), but the actual direction taken was explicit: keep sending on SES while inbound goes through IMAP against a single shared mailbox. That means this build gets option (b)'s basic shape (reading a real mailbox) without yet paying (b)'s full cost from the original analysis — no per-user OAuth, because it's one shared account, not one per rep. See §5a for what that actually looks like and what it still doesn't cover.

These two options don't actually solve the same problem, which is the first thing to get straight before picking one.

**SES inbound** (receipt rule → S3 action, optionally + an SNS notification for "new mail arrived") can only ever see mail sent **to an address on a domain whose MX record points at AWS**. That means:
- **Region-limited.** SES inbound receiving is supported in only a handful of regions — historically a short list including `us-east-1`, `us-west-2`, and `eu-west-1`. **Verify the current list against AWS's SES documentation before committing to a region for this**, since (a) I can't confirm it's still accurate as of today and (b) it constrains where the receipt rule set/S3 bucket live, independent of where the rest of the app or its region of convenience is.
- **Requires owning the MX record** for whatever domain/subdomain receives the mail. If that's the dedicated `mail.simplycrm.app` subdomain from §2, this is low-risk — nothing else was using that subdomain's MX anyway. If the intent were ever "receive mail sent to our *real* support/sales address," pointing that domain's MX at SES means **it stops being deliverable to wherever it currently goes** (Gmail, Outlook, etc.) — you cannot have two MX destinations for the same domain active at once in any meaningful way.

**What SES inbound is actually good for here:** capturing replies to a CRM-*generated* thread at a CRM-*owned* address — e.g. outbound mail goes out with `Reply-To: reply+<threadToken>@mail.simplycrm.app`, and when the prospect hits "reply," SES inbound captures it, we parse the `reply+<token>@...` local part to resolve the `EmailThread`, and done. This never touches the rep's real mailbox and needs no cross-provider coordination.

**What SES inbound does *not* solve:** "show the rep's existing Gmail/Outlook inbox and sent mail inside the CRM." That mail was never addressed to our domain — it's sitting in the rep's actual mailbox provider. No amount of MX/SES configuration makes SES aware of mail that never routed through it. If that's the actual product requirement — and for a CRM, "see my real email inside the CRM" is a very common ask — the only way to get it is **IMAP (or, better where available, the Gmail API / Microsoft Graph)** against each rep's real mailbox, which means:
- OAuth (Gmail/Graph) or stored IMAP credentials per connected mailbox, one per rep.
- Polling (IMAP `IDLE`/periodic poll) or provider push (Gmail `watch` + Pub/Sub, Graph webhooks) — an entirely separate ingestion mechanism from the SES/SNS pipeline in §3, with its own retry/failure model.
- No DNS/MX risk at all — the rep's real mail keeps flowing wherever it already does.

**⚠ Decision needed — this is a product question, not an infra one:** is the goal (a) "let the CRM send mail and capture replies to that specific mail," or (b) "let reps see/send their real email inside the CRM"? (a) is what SES inbound + the `Reply-To` pattern above cleanly supports, and composes naturally with everything already speced for sending. (b) requires IMAP/Gmail API/Graph regardless of anything decided about SES, and is a materially larger feature (per-user OAuth flows, token storage/refresh, a second ingestion pipeline) that doesn't go away even if SES inbound is also built. Recommending (a) as the v1 scope — it's a complete, self-contained feature that doesn't need per-user mailbox auth — with (b) tracked as a distinct, larger future feature rather than something this spec's SES work quietly delivers. **Do not assume building SES inbound is a step toward (b); it isn't.**

If (a): the inbound pipeline is receipt rule → S3 (raw MIME) → SNS notification → (same SNS→app mechanism decided in §3) → fetch the object from S3, parse MIME, resolve `In-Reply-To`/`References` headers against `EmailMessage.rfc822MessageId` to find the thread (fall back to the `reply+<token>@` local-part if headers are stripped/mangled, which happens with some mail clients/forwarders), create the inbound `EmailMessage` + `Activity`.

## 5a. What was actually built: IMAP against a single shared mailbox

`server/src/lib/imapSync.ts`, using `imapflow` (client) and `mailparser` (MIME parsing). No SES inbound, no S3, no inbound-side SNS — none of §3's event-destination machinery is involved in receiving at all; that's purely an outbound-events concern (still unbuilt either way, per the status line at the top of this document).

**Scope, explicitly:** one IMAP account (`IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD`), syncing two folders (`IMAP_INBOX_FOLDER`, `IMAP_SENT_FOLDER`, both configurable — folder naming isn't standardized, e.g. Gmail uses `[Gmail]/Sent Mail`). **Not** per-rep connected mailboxes — that's still the larger, separate feature the original §5 analysis described under option (b), with its own OAuth/token-storage cost that this build does not pay. If "every rep connects their own inbox" becomes the actual requirement, that's new work, not an extension of this worker.

**Poll, don't push:** a `setInterval` loop — connect, sync both folders, disconnect, repeat every `IMAP_POLL_INTERVAL_MS` (default 60s) — rather than a persistent IDLE connection. ⚠ **Judgment call**, same shape as §4a's send-queue tradeoff: IDLE would cut latency to near-zero but means managing a long-lived connection's reconnect logic and RFC 2177's ~29-minute IDLE renewal window; polling is simpler and more robust to get right, at the cost of up to one poll interval of lag before new mail shows up. Revisit if near-real-time inbound matters more than operational simplicity.

**Resuming instead of refetching:** `ImapFolderState` persists `uidValidity` and `lastSeenUid` per folder. Normal case: next sync fetches `UID (lastSeenUid+1):*`. If the server reports a **different** `uidValidity` than stored, every previously-recorded UID for that folder is void by IMAP's own rules (RFC 3501 §2.3.1.1) — handled as a full resync (`UID 1:*`), not an attempt to reconcile old and new UID spaces, which isn't meaningful. Verified directly against Postgres (the resume-vs-resync decision and a real server restart mid-sync), though not against a real IMAP server's actual UIDVALIDITY-change behavior — no test mailbox was available to trigger that condition for real.

**Reconciling SES-sent mail against the Sent folder:** every `EmailMessage` (sent via SES or discovered via IMAP) is deduped purely on `rfc822MessageId` (`upsertParsedMessage`). A message created at compose time and later seen again while syncing Sent just gets its `imapUid`/`imapFolder` recorded on the existing row — never a second row. Verified end-to-end against real Postgres data (a seeded SES-sent message was "found" again via a simulated Sent-folder fetch; message count was unchanged, `direction` stayed correct).

**Threading:** `In-Reply-To`/`References` resolved against existing `EmailMessage.rfc822MessageId` first (correct per RFC 5322); falls back to a loose contact + normalized-subject match (`Re:`/`Fwd:` prefixes stripped) when headers are missing or stripped; otherwise starts a new `EmailThread`. Verified: a synthetic reply with `In-Reply-To` set resolved to the same thread as its parent.

**Contact linking:** by email address — inbound links via the `From` address, a Sent-folder message not already in our DB links via its first `To` address. Both are exact-ish (case-insensitive) matches against `Contact.email`; no fuzzy matching, no handling of a contact with multiple known addresses.

**No `Activity` row for anything IMAP discovers** — see the correction in §4's Activity-integration note above. `authorId` on an IMAP-sourced `EmailMessage` is always `null`.

**Known gaps, not addressed here:**
- No historical backfill cap — first sync of a long-lived mailbox fetches its entire history for the watched folders. Fine for a fresh/small mailbox; could be slow for an old one. A `SINCE`-bounded initial sync would be the fix if this becomes a real problem.
- A message that fails to parse is logged and skipped (not retried) — see CLAUDE.md.
- No handling of multiple `From` addresses, address groups beyond the first entry, or a contact with more than one known email address.

## 6. IAM Policy

Least-privilege, split by **when** the permission is needed — runtime (the app's own role/user) vs. provisioning (done once via console/IaC by whoever sets this up, not something the app ever calls). **The actual shipped runtime policy is [`server/aws/ses-iam-policy.json`](./server/aws/ses-iam-policy.json), explained in [SETUP.md](./SETUP.md#4-iam-policy-for-the-running-app)** — that's the authoritative copy; this section summarizes rather than duplicates it, to avoid the two drifting apart.

**Provisioning-time only (not on the app's runtime credentials):** `ses:CreateEmailIdentity`, `ses:PutEmailIdentityDkimAttributes`, `ses:CreateConfigurationSet`, `ses:*ConfigurationSetEventDestination`, `ses:PutAccountSuppressionAttributes`, `ses:PutAccountVdmAttributes`, S3 bucket creation/policy (once inbound exists), `sns:CreateTopic`, Route 53 record changes. These run once (or rarely) via the operator script (`server/scripts/ses-setup.ts`), with the operator's own broader AWS credentials — never the deployed app's.

**Runtime policy**, as shipped: `ses:SendEmail`/`ses:SendRawEmail` scoped to the one identity ARN, with **both** a `ses:configuration-set` condition (every send under this credential is wired into the event pipeline — no code path can silently send unmonitored mail) **and** a `ses:FromAddress` condition (pinned to the single configured `SES_FROM_ADDRESS`; becomes a `StringLike` pattern instead of an exact match if/when the per-user-sending-address option from §2's open question is chosen instead) — plus two narrow read-only statements, `ses:GetEmailIdentity` (scoped to the identity) and `ses:GetAccount` (necessarily `Resource: "*"`, since SES has no resource-level permission for that account-wide action), for the in-app health check and the §4a rate-limit lookup. No `ses:List*`/`ses:Verify*`/other `ses:Put*` — those are provisioning-time, per above. The S3/SQS statements sketched in earlier drafts of this doc are deferred until §5's inbound pipeline is actually built; they'd be scoped to one bucket/one queue the same way, never account-wide.

## 7. Dependencies / Config Summary

- Runtime dependencies (server only): `@aws-sdk/client-sesv2`; `nodemailer` (just for its `MailComposer` — raw MIME building, no SMTP transport ever constructed, per §1); `imapflow` (IMAP client, ships its own types); `mailparser` (MIME parsing, needs `@types/mailparser` separately — it doesn't ship its own, unlike the others here).
- Dev-only dependency: `@aws-sdk/client-sns`, used solely by the provisioning script (`server/scripts/ses-setup.ts`) to create the events topic — the running app never calls any SNS API itself (see §6).
- Env vars (`server/.env.example`, all optional — the app boots fine without them): `AWS_REGION`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (local dev only — never set in deployment, where an IAM role is used instead), `SES_SENDING_DOMAIN`, `SES_CONFIGURATION_SET`, `SES_FROM_ADDRESS`; `IMAP_HOST`/`IMAP_PORT`/`IMAP_SECURE`/`IMAP_USER`/`IMAP_PASSWORD` (a real password — no credential-chain equivalent exists for plain IMAP, see CLAUDE.md), `IMAP_INBOX_FOLDER`/`IMAP_SENT_FOLDER`/`IMAP_POLL_INTERVAL_MS`.
- Prisma models shipped: `EmailThread`, `EmailMessage`, `EmailAttachment`, `ImapFolderState` (§4, §5a), plus `User.signatureText` for per-user signatures and `EmailMessage.imapUid`/`imapFolder` for IMAP traceability. **Not yet shipped:** `EmailEvent` and its `EmailEventType` enum — that's tied to §3's unbuilt SES event ingestion (receiving itself is built, via IMAP, per §5a — these are separate things).
- New infra (outside this repo, provisioned via `server/scripts/ses-setup.ts` + `SETUP.md`): verified SES domain identity + DKIM/SPF/DMARC DNS records, one configuration set (reputation metrics on), one SNS topic wired as its event destination, account-level suppression list; one IMAP mailbox account (credentials only, provisioned wherever that mailbox already lives — nothing to stand up). **Not yet provisioned:** anything SQS/S3/SES-receipt-rule related — that's §3's still-unbuilt outbound event ingestion; it was never needed for §5a's IMAP-based receiving in the first place.

## 8. Decisions Flagged for Product/Infra Sign-off

Collected from above — none of these are blocked on code, but code shouldn't start until they're answered, since each one changes the schema or the pipeline shape:

1. **§2 — Shared sending address vs. per-user sending address.** Defaulted to shared (`notifications@mail.simplycrm.app`) + `Reply-To` per thread.
2. **§3 — SNS→HTTPS webhook vs. SNS→SQS→worker** for event ingestion. Defaulted to the webhook for v1 given no worker infra exists yet, revisit when/if inbound (§5) justifies standing up a worker anyway.
3. **§4 — Raw JSON payload vs. normalized columns** for bounce/complaint detail on `EmailEvent`. Defaulted to raw JSON; promote fields to columns only when a real query need shows up.
4. **§5 — RESOLVED, by explicit instruction: IMAP, not SES inbound** — and not quite either of the original two options. It's a single shared mailbox (§5a), so it has (a)'s low setup cost (no per-user OAuth) while giving something closer to (b)'s shape (a real mailbox, not just captured replies to CRM-generated mail). Per-rep connected mailboxes remain a distinct, larger, unaddressed feature if that turns out to be the actual ask.
5. **§5 — SES-inbound-supported region** is now moot — not used, since receiving went through IMAP instead.
6. **§4a — In-process Postgres-polling send queue vs. a real job-queue library or SQS.** Defaulted to in-process polling: durable across restarts, no new infra, but not safe across multiple app instances as written. Revisit alongside decision 2 above if this app is ever horizontally scaled — and now also alongside decision 7, since a worker process exists for IMAP polling too.
7. **§5a — IMAP poll vs. persistent IDLE connection.** Defaulted to polling (60s default) for the same reason as decision 6 — simpler failure/reconnect model, no infra to stand up — at the cost of up to one poll interval of latency on new mail. Revisit if near-real-time inbound becomes a real requirement.
