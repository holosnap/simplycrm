import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { isAttachmentStorageConfigured, uploadAttachment } from "./attachmentStorage";
import type { EmailDirection } from "@prisma/client";

// Inbound stays on IMAP (a single shared mailbox) while sending goes through
// SES — see EMAIL_SPEC.md §5. This is a poller, not a persistent IDLE
// connection: connect, sync each watched folder, disconnect, repeat on
// IMAP_POLL_INTERVAL_MS. Simpler and more robust than managing a long-lived
// IDLE session (reconnects, the ~29min RFC 2177 renewal window) at the cost
// of up-to-one-poll-interval latency — a deliberate tradeoff for this app's
// scale, consistent with emailQueue.ts's polling-over-push choice.

function isImapConfigured(): boolean {
  return Boolean(env.imapHost && env.imapUser && env.imapPassword);
}

// Generous but bounded: a message's full RFC822 source (headers + all MIME
// parts, base64-inflated) is what gets buffered in memory whole before
// parsing — see the size-check pass in syncFolder. 30MB comfortably covers
// normal attachment-bearing mail (Gmail/Outlook cap attachments well under
// this) while still bounding how much any single message, malicious or
// otherwise, can force into memory at once.
const MAX_INBOUND_MESSAGE_BYTES = 30 * 1024 * 1024;

function firstAddress(addr: AddressObject | AddressObject[] | undefined): string | null {
  if (!addr) return null;
  const objects = Array.isArray(addr) ? addr : [addr];
  return objects[0]?.value[0]?.address ?? null;
}

function allAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return [];
  const objects = Array.isArray(addr) ? addr : [addr];
  return objects.flatMap((o) => o.value.map((v) => v.address).filter((a): a is string => Boolean(a)));
}

function normalizeSubject(subject: string): string {
  let current = subject.trim();
  let previous: string;
  do {
    previous = current;
    current = current.replace(/^(re|fwd?):\s*/i, "").trim();
  } while (current !== previous);
  return current;
}

async function findContactIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const contact = await prisma.contact.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return contact?.id ?? null;
}

// Thread resolution: follow In-Reply-To/References to an existing message's
// thread first (the correct way per EMAIL_SPEC.md §5); fall back to a loose
// contact+normalized-subject match for mail whose threading headers got
// stripped by some provider/forwarder along the way; otherwise start a new
// thread.
async function resolveThreadId(parsed: ParsedMail, contactId: string | null, subject: string): Promise<string> {
  const referenceIds = [
    ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
    ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
  ];

  for (const referenceId of referenceIds) {
    const match = await prisma.emailMessage.findUnique({
      where: { rfc822MessageId: referenceId },
      select: { threadId: true },
    });
    if (match) return match.threadId;
  }

  if (contactId) {
    const normalized = normalizeSubject(subject);
    const candidateThreads = await prisma.emailThread.findMany({
      where: { contactId },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
      select: { id: true, subject: true },
    });
    const looseMatch = candidateThreads.find((t) => normalizeSubject(t.subject) === normalized);
    if (looseMatch) return looseMatch.id;
  }

  const thread = await prisma.emailThread.create({
    data: { contactId, subject, lastMessageAt: parsed.date ?? new Date() },
  });
  return thread.id;
}

// A single oversized/corrupt attachment shouldn't lose the whole message —
// same "forward progress over perfect delivery" principle as a message that
// fails to parse (see syncFolder below) — so each attachment is uploaded
// independently and a failure just drops that one, logged, rather than
// failing the message. If attachment storage isn't configured at all, every
// attachment on the message is dropped (the message itself still syncs).
async function uploadInboundAttachments(parsed: ParsedMail, rfc822MessageId: string) {
  if (parsed.attachments.length === 0) return [];
  if (!isAttachmentStorageConfigured()) {
    console.warn(
      `IMAP sync: dropping ${parsed.attachments.length} attachment(s) on ${rfc822MessageId} — attachment storage is not configured (see SETUP.md).`,
    );
    return [];
  }

  const uploaded: Awaited<ReturnType<typeof uploadAttachment>>[] = [];
  for (const attachment of parsed.attachments) {
    try {
      uploaded.push(
        await uploadAttachment({
          filename: attachment.filename ?? "attachment",
          declaredContentType: attachment.contentType,
          data: attachment.content as Buffer,
        }),
      );
    } catch (err) {
      console.error(`IMAP sync: failed to store an attachment on ${rfc822MessageId}:`, err);
    }
  }
  return uploaded;
}

// Dedupe on Message-ID: a message we sent via SES also shows up here when we
// sync the Sent folder. If a row already exists (because emailThreads.ts
// created it at compose time) this just records where we saw it via IMAP and
// returns — it never creates a second row, so it shows once.
export async function upsertParsedMessage(
  folder: string,
  direction: EmailDirection,
  uid: number,
  parsed: ParsedMail,
) {
  const rfc822MessageId = parsed.messageId ?? `<imap-fallback-${folder}-${uid}@${env.imapFallbackMessageIdHost}>`;

  const existing = await prisma.emailMessage.findUnique({ where: { rfc822MessageId } });
  if (existing) {
    if (existing.imapUid === null) {
      await prisma.emailMessage.update({
        where: { id: existing.id },
        data: { imapUid: BigInt(uid), imapFolder: folder },
      });
    }
    return;
  }

  const fromAddress = firstAddress(parsed.from) ?? "unknown@unknown.invalid";
  const toAddresses = allAddresses(parsed.to);
  const ccAddresses = allAddresses(parsed.cc);
  // Inbound: link by who sent it to us. Outbound (Sent folder, not already
  // in our DB — e.g. sent directly via webmail, bypassing the CRM): link by
  // who we sent it to.
  const linkEmail = direction === "inbound" ? fromAddress : (toAddresses[0] ?? null);
  const contactId = await findContactIdByEmail(linkEmail);
  const subject = parsed.subject ?? "(no subject)";
  const threadId = await resolveThreadId(parsed, contactId, subject);
  const attachments = await uploadInboundAttachments(parsed, rfc822MessageId);

  try {
    await prisma.emailMessage.create({
      data: {
        threadId,
        contactId,
        direction,
        authorId: null, // no known User authored an IMAP-discovered message — see CLAUDE.md
        rfc822MessageId,
        inReplyTo: parsed.inReplyTo ?? null,
        fromAddress,
        toAddresses: toAddresses.length > 0 ? toAddresses : ["unknown@unknown.invalid"],
        ccAddresses,
        subject,
        bodyText: parsed.text ?? null,
        bodyHtml: parsed.html || null,
        // EmailMessageStatus was originally scoped to our own send pipeline
        // (EMAIL_SPEC.md §4); repurposed here for IMAP-observed state since
        // there's no better fit: "delivered" for mail that arrived in our
        // inbox, "sent" for mail sitting in Sent (it evidently went out).
        status: direction === "outbound" ? "sent" : "delivered",
        sentAt: direction === "outbound" ? (parsed.date ?? new Date()) : null,
        imapUid: BigInt(uid),
        imapFolder: folder,
        attachments: { create: attachments },
      },
    });
  } catch (err) {
    // rfc822MessageId is @unique — if another sync run (a second app
    // instance, or an overlapping poll) raced us between the findUnique
    // check above and this create, that race lands here as a unique
    // constraint violation rather than silent data loss: the other run's
    // row already exists with the same content, so this is a true no-op,
    // not a failure. Anything else (a real DB error) still propagates and
    // gets logged/skipped by syncFolder's per-message catch, same as today.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    throw err;
  }

  await prisma.emailThread.update({ where: { id: threadId }, data: { lastMessageAt: parsed.date ?? new Date() } });

  // Deliberately no Activity row here: Activity.authorId is required (real
  // accountability data per CLAUDE.md), and no User authored this message.
  // It's still fully visible via the Email section on the Contact/Deal,
  // which reads EmailThread/EmailMessage directly, independent of Activity.
}

async function syncFolder(client: ImapFlow, folder: string, direction: EmailDirection) {
  const mailbox = await client.mailboxOpen(folder);
  const state = await prisma.imapFolderState.findUnique({ where: { folder } });

  const currentUidValidity = mailbox.uidValidity;
  const uidValidityChanged = state ? state.uidValidity !== currentUidValidity : false;
  if (state && uidValidityChanged) {
    // Per IMAP (RFC 3501 §2.3.1.1), a changed UIDVALIDITY means every UID
    // this server previously handed out for this folder may now mean a
    // different message (or nothing) — the old lastSeenUid is meaningless,
    // so this does a full resync rather than trying to reconcile it.
    console.warn(
      `IMAP folder "${folder}": UIDVALIDITY changed (${state.uidValidity} -> ${currentUidValidity}) — full resync.`,
    );
  }

  const startUid = state && !uidValidityChanged ? Number(state.lastSeenUid) + 1 : 1;
  let maxUidSeen = state && !uidValidityChanged ? state.lastSeenUid : 0n;

  if (mailbox.exists > 0) {
    // Check sizes before fetching any body. IMAP has no way to request a
    // message's full RFC822 source and then "change its mind" partway
    // through — once `source: true` is on a FETCH, the server sends the
    // whole thing and imapflow buffers it into one Buffer per message. A
    // single huge message (or an attacker-controlled one) would otherwise
    // be pulled entirely into memory before we ever get a chance to look at
    // it. This first pass fetches only `size`+`uid` (cheap, no body) so
    // oversized messages can be excluded from the second, body-fetching
    // pass entirely — never downloaded, not even once.
    const safeUids: number[] = [];
    for await (const message of client.fetch(`${startUid}:*`, { uid: true, size: true }, { uid: true })) {
      if (message.uid < startUid) continue;
      if (BigInt(message.uid) > maxUidSeen) maxUidSeen = BigInt(message.uid);

      if ((message.size ?? 0) > MAX_INBOUND_MESSAGE_BYTES) {
        console.warn(
          `IMAP sync: skipping "${folder}" UID ${message.uid} — ${((message.size ?? 0) / 1024 / 1024).toFixed(1)}MB, ` +
            `over the ${MAX_INBOUND_MESSAGE_BYTES / 1024 / 1024}MB cap; left unprocessed, same as an unparseable message.`,
        );
        continue;
      }
      safeUids.push(message.uid);
    }

    if (safeUids.length > 0) {
      for await (const message of client.fetch(safeUids, { source: true }, { uid: true })) {
        if (!message.source) continue;

        try {
          const parsed = await simpleParser(message.source);
          await upsertParsedMessage(folder, direction, message.uid, parsed);
        } catch (err) {
          // Logged and skipped, not retried indefinitely — a single
          // unparseable message (malformed MIME, etc.) shouldn't stall sync
          // of everything after it forever.
          console.error(`IMAP sync: failed to process "${folder}" UID ${message.uid}:`, err);
        }
      }
    }
  }

  await prisma.imapFolderState.upsert({
    where: { folder },
    create: { folder, uidValidity: currentUidValidity, lastSeenUid: maxUidSeen },
    update: { uidValidity: currentUidValidity, lastSeenUid: maxUidSeen },
  });
}

async function runSync() {
  const client = new ImapFlow({
    host: env.imapHost!,
    port: env.imapPort,
    secure: env.imapSecure,
    auth: { user: env.imapUser!, pass: env.imapPassword! },
    logger: false,
  });

  await client.connect();
  try {
    await syncFolder(client, env.imapInboxFolder, "inbound");
    await syncFolder(client, env.imapSentFolder, "outbound");
  } finally {
    await client.logout().catch(() => client.close());
  }
}

let tickRunning = false;

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runSync();
  } catch (err) {
    console.error("IMAP sync failed:", err);
  } finally {
    tickRunning = false;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startImapSyncWorker() {
  if (intervalHandle) return;
  if (!isImapConfigured()) {
    console.log("IMAP sync worker disabled — IMAP is not configured yet (see server/.env.example).");
    return;
  }

  void tick(); // sync once immediately on boot rather than waiting a full interval
  intervalHandle = setInterval(() => void tick(), env.imapPollIntervalMs);
  console.log(`IMAP sync worker started (polling every ${env.imapPollIntervalMs}ms).`);
}
