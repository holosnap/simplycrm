import { prisma } from "./prisma";
import { env } from "./env";
import { sendQueuedEmail, type QueuedEmailMessage } from "./emailSend";
import { getMaxSendRate } from "./sesQuota";
import { isPermanentError, backoffDelayMs, MAX_ATTEMPTS } from "./emailRetry";

// Sends are queued, not fired inline from the request, and processed here by
// a single in-process poller. This is a deliberately simple choice over a
// real job-queue library or a separate worker process/SQS: this app has no
// background-worker infrastructure today (see CLAUDE.md), runs as one
// process, and send volume is modest — a Postgres-backed queue with an
// in-process ticker is durable (survives restarts; see recoverInterruptedSends
// below) without a new infra dependency. It would NOT be safe as-is across
// multiple app instances (no cross-process claim/locking — see the
// `tickRunning` guard below, which only prevents overlap within one
// process); horizontally scaling this app would need real row-level claiming
// (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`) or a move to a proper queue.

const TICK_INTERVAL_MS = 2_000;
const BATCH_SIZE = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSesConfigured(): boolean {
  return Boolean(env.awsRegion && env.sesSendingDomain && env.sesConfigurationSet && env.sesFromAddress);
}

// A message stuck in "sending" means the server died mid-call to SES — we
// genuinely don't know whether SES accepted it before the process died.
// Auto-retrying risks sending a duplicate email to the recipient, which for
// a CRM talking to real prospects is worse than a delayed send, so this
// never resumes those automatically. It marks them failed (surfaced in the
// UI per the "never fail silently" requirement) for a human to check SES's
// own history/the recipient's inbox before deciding whether to resend.
async function recoverInterruptedSends() {
  const { count } = await prisma.emailMessage.updateMany({
    where: { status: "sending" },
    data: {
      status: "failed",
      lastError: "Interrupted mid-send during a previous server run — verify manually before resending.",
    },
  });
  if (count > 0) {
    console.warn(`Email queue: marked ${count} interrupted send(s) as failed for manual review.`);
  }
}

async function logSendActivity(message: QueuedEmailMessage, sentAt: Date) {
  if (!message.contactId || !message.authorId) return; // nothing to attach the timeline entry to
  try {
    await prisma.activity.create({
      data: {
        contactId: message.contactId,
        dealId: message.dealId,
        authorId: message.authorId,
        type: "email",
        body: `Sent: ${message.subject}`,
        occurredAt: sentAt,
      },
    });
  } catch (err) {
    // The email itself sent fine; this is just the timeline projection.
    // Don't let a failure here look like the send failed.
    console.error(`Could not log Activity for sent email ${message.id}:`, err);
  }
}

async function processMessage(messageId: string) {
  const message = await prisma.emailMessage.findUnique({
    where: { id: messageId },
    include: { attachments: true },
  });
  if (!message || message.status !== "queued") return; // already handled (shouldn't happen in-process, but safe)

  const claimed = await prisma.emailMessage.update({
    where: { id: messageId },
    data: { status: "sending", attempts: { increment: 1 } },
    include: { attachments: true },
  });

  try {
    const { sesMessageId } = await sendQueuedEmail(claimed);
    const sentAt = new Date();
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: { status: "sent", sesMessageId, sentAt, lastError: null, nextAttemptAt: null },
    });
    await logSendActivity(claimed, sentAt);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (isPermanentError(err) || claimed.attempts >= MAX_ATTEMPTS) {
      await prisma.emailMessage.update({
        where: { id: messageId },
        data: { status: "failed", lastError: errorMessage },
      });
      console.error(`Email ${messageId} failed permanently after ${claimed.attempts} attempt(s):`, errorMessage);
    } else {
      const delay = backoffDelayMs(claimed.attempts);
      await prisma.emailMessage.update({
        where: { id: messageId },
        data: { status: "queued", lastError: errorMessage, nextAttemptAt: new Date(Date.now() + delay) },
      });
      console.warn(
        `Email ${messageId} attempt ${claimed.attempts} failed, retrying in ~${Math.round(delay / 1000)}s:`,
        errorMessage,
      );
    }
  }
}

let tickRunning = false;

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const maxSendRate = await getMaxSendRate();
    const minIntervalMs = Math.max(1000 / maxSendRate, 50);

    const due = await prisma.emailMessage.findMany({
      where: {
        direction: "outbound",
        status: "queued",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: { id: true },
    });

    for (const { id } of due) {
      await processMessage(id);
      await sleep(minIntervalMs); // pace to the account's actual send rate, not a hardcoded number
    }
  } catch (err) {
    console.error("Email queue tick failed:", err);
  } finally {
    tickRunning = false;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startEmailQueueWorker() {
  if (intervalHandle) return;
  if (!isSesConfigured()) {
    console.log("Email queue worker disabled — SES is not fully configured yet (see SETUP.md).");
    return;
  }

  recoverInterruptedSends().catch((err) => console.error("Email queue recovery sweep failed:", err));
  intervalHandle = setInterval(() => void tick(), TICK_INTERVAL_MS);
  console.log("Email queue worker started.");
}
