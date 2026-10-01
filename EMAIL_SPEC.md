# Email Integration Spec

Status: **draft, pre-implementation**. This covers sending/receiving email through AWS SES and how it plugs into the existing `Contact` / `Deal` / `Activity` data model (see [SPEC.md](./SPEC.md), [CLAUDE.md](./CLAUDE.md)). Nothing here is built yet. Several points below are genuine tradeoffs rather than clear-cut defaults — they're marked **⚠ Decision needed** and summarized again in §8.

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
| s3ObjectKey | string | nullable — set for inbound messages where SES wrote the raw MIME to S3 (§5); outbound bodies are generated by us so we don't need to re-fetch them from anywhere |
| status | enum(`queued`, `sent`, `delivered`, `bounced`, `complained`, `failed`) | **Denormalized latest-state snapshot**, derived from the `EmailEvent` history. See tradeoff note below. |
| createdAt / updatedAt | timestamp | |
| sentAt | timestamp | nullable |

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

**Integration with the existing `Activity` model:** `ActivityType` already has an `email` value (see `server/prisma/schema.prisma`). When an `EmailMessage` is sent or received, create a corresponding `Activity` row (`type: email`, `body`: subject + snippet) linked to the same `Contact`/`Deal`, so email shows up in the existing contact timeline UI without that UI needing to know about `EmailMessage` at all. `EmailMessage` is the detailed record (headers, body, delivery status); `Activity` is the timeline-summary projection of it — don't duplicate full body content into `Activity.body`, just enough to render the timeline row.

## 5. Receiving Email: SES Inbound vs. IMAP — the real tradeoff

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

## 6. IAM Policy

Least-privilege, split by **when** the permission is needed — runtime (the app's own role/user) vs. provisioning (done once via console/IaC by whoever sets this up, not something the app ever calls):

**Provisioning-time only (not on the app's runtime credentials):** `ses:VerifyDomainIdentity`, `ses:PutConfigurationSetEventDestination`, `ses:SetIdentityDkimEnabled`, S3 bucket creation/policy, `sns:CreateTopic`/`Subscribe`, Route 53 record changes. These happen once (or rarely) and should go through whatever deploy/infra process manages the rest of the stack — the running Express app has no business holding permission to reconfigure SES.

**Runtime policy** (attached to the IAM user/role the app actually authenticates as):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendFromOurIdentityOnly",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "arn:aws:ses:REGION:ACCOUNT_ID:identity/mail.simplycrm.app",
      "Condition": {
        "StringEquals": {
          "ses:configuration-set": "simplycrm-transactional"
        }
      }
    },
    {
      "Sid": "ReadInboundRawMime",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::simplycrm-inbound-email/*"
    },
    {
      "Sid": "ConsumeEventQueue",
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:simplycrm-ses-events"
    }
  ]
}
```

Notes on why it's shaped this way:
- `Resource` on the send statement is the **specific identity ARN**, not `"*"` — this account can only ever send from `mail.simplycrm.app`, so a leaked credential can't be used to send as some other verified identity on the same AWS account (relevant if this AWS account is ever shared with other projects).
- The `ses:configuration-set` condition means a send call that omits our configuration set (or names a different one) is denied outright — this guarantees every message that actually leaves SES under this credential is wired into the event pipeline in §3; there's no code path that can "forget" to attach it and silently send unmonitored mail.
- No `ses:Get*`/`ses:List*` reconnaissance permissions (e.g. `ses:GetAccountSendingEnabled`, `ses:ListIdentities`) — the app doesn't need to introspect its own account, so it can't.
- S3 and SQS resources are each scoped to **the one bucket / one queue** this feature owns, not account-wide `s3:*`/`sqs:*` or a `*` resource. If other AWS resources exist on this account for unrelated purposes, this role can't touch them.
- If the §3 decision lands on direct SNS→HTTPS instead of SQS, drop the `ConsumeEventQueue` statement entirely — the app never calls any SNS API in that model (SNS calls *us*, over HTTPS, unauthenticated-but-signature-verified), so it needs zero SNS IAM permissions either way. That asymmetry (receiving pushes need no IAM at all; only pulling from SQS does) is worth keeping in mind as a point in favor of the simpler webhook model from a pure "fewer permissions to manage" angle, even though §3 leans the other way on reliability grounds.

## 7. Dependencies / Config Summary

- New runtime dependency: `@aws-sdk/client-sesv2` (server only).
- New env vars (`server/.env.example`): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or role-based credentials if the hosting target supports it), `SES_CONFIGURATION_SET`, `SES_SENDING_DOMAIN`.
- New Prisma models: `EmailThread`, `EmailMessage`, `EmailEvent` (§4), plus enums `EmailDirection`, `EmailMessageStatus`, `EmailEventType`.
- New infra (outside this repo): verified SES domain identity + DKIM/SPF/DMARC DNS records, one configuration set, one SNS topic, (if §3/§5 land on the queue option) one SQS queue + DLQ, (for inbound) one S3 bucket + SES receipt rule set.

## 8. Decisions Flagged for Product/Infra Sign-off

Collected from above — none of these are blocked on code, but code shouldn't start until they're answered, since each one changes the schema or the pipeline shape:

1. **§2 — Shared sending address vs. per-user sending address.** Defaulted to shared (`notifications@mail.simplycrm.app`) + `Reply-To` per thread.
2. **§3 — SNS→HTTPS webhook vs. SNS→SQS→worker** for event ingestion. Defaulted to the webhook for v1 given no worker infra exists yet, revisit when/if inbound (§5) justifies standing up a worker anyway.
3. **§4 — Raw JSON payload vs. normalized columns** for bounce/complaint detail on `EmailEvent`. Defaulted to raw JSON; promote fields to columns only when a real query need shows up.
4. **§5 — The big one: "capture replies to CRM mail" vs. "sync the rep's real inbox."** These are different features with different cost (self-contained vs. per-user OAuth + a second ingestion pipeline). Defaulting this spec's scope to the former; the latter is out of scope here, not a natural follow-on.
5. **§5 — Exact SES-inbound-supported region**, which constrains where the receipt rule/S3 bucket live — needs a current-docs check at implementation time, not assumed from this document.
