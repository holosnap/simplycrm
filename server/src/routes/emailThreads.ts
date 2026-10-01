import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { publicUserSelect } from "../lib/publicUser";
import { isAttachmentStorageConfigured, uploadAttachment, type UploadedAttachment } from "../lib/attachmentStorage";

export const emailThreadsRouter = Router();

// SES's hard ceiling is 10MB for the whole encoded message. Base64 inflates
// raw bytes by ~4/3, and MIME multipart framing adds a bit more on top, so
// this caps well under that rather than letting SES reject it opaquely at
// send time. (attachmentStorage.ts separately caps any single file.)
const MAX_ATTACHMENTS_BYTES = 7 * 1024 * 1024;

const attachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  dataBase64: z.string().min(1),
});

async function decodeAndUploadAttachments(
  input: z.infer<typeof attachmentSchema>[],
): Promise<UploadedAttachment[]> {
  if (input.length === 0) return [];
  if (!isAttachmentStorageConfigured()) {
    const error = new Error("Attachments aren't supported yet — attachment storage isn't configured (see SETUP.md).");
    error.name = "AttachmentsNotConfigured";
    throw error;
  }

  let totalBytes = 0;
  const decoded = input.map((attachment) => {
    const data = Buffer.from(attachment.dataBase64, "base64");
    totalBytes += data.length;
    return { filename: attachment.filename, declaredContentType: attachment.contentType, data };
  });
  if (totalBytes > MAX_ATTACHMENTS_BYTES) {
    const error = new Error(
      `Attachments total ${(totalBytes / 1024 / 1024).toFixed(1)}MB, over the ${MAX_ATTACHMENTS_BYTES / 1024 / 1024}MB limit.`,
    );
    error.name = "AttachmentsTooLarge";
    throw error;
  }

  return Promise.all(decoded.map((attachment) => uploadAttachment(attachment)));
}

// HTML alternative is derived from the plain text we actually stored, not
// authored separately — what's in bodyText (signature included, since the
// client appends it before submitting) is exactly what gets escaped here.
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

const threadSummarySelect = {
  id: true,
  subject: true,
  lastMessageAt: true,
  createdAt: true,
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, direction: true, subject: true, fromAddress: true, sentAt: true, lastError: true },
  },
};

// Unfiltered (no contactId/dealId) = the Inbox view, across every thread.
emailThreadsRouter.get("/", async (req, res) => {
  const { contactId, dealId } = req.query;

  const threads = await prisma.emailThread.findMany({
    where: {
      contactId: contactId ? String(contactId) : undefined,
      dealId: dealId ? String(dealId) : undefined,
    },
    select: threadSummarySelect,
    orderBy: { lastMessageAt: "desc" },
  });

  res.json({ threads });
});

emailThreadsRouter.get("/:id", async (req, res) => {
  const thread = await prisma.emailThread.findUnique({
    where: { id: req.params.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: publicUserSelect },
          attachments: {
            select: { id: true, filename: true, declaredContentType: true, detectedContentType: true, sizeBytes: true },
          },
        },
      },
    },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });
  res.json({ thread });
});

function dedupeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of addresses) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

// "Our own" addresses never belong in a computed To/Cc — the client has no
// way to know these, so this (and the recipient defaults below) has to live
// server-side.
function ourAddresses(): Set<string> {
  return new Set([env.sesFromAddress, env.imapUser].filter((a): a is string => Boolean(a)).map((a) => a.toLowerCase()));
}

function computeReplyDefaults(
  previousMessage: { direction: string; fromAddress: string; toAddresses: string[]; ccAddresses: string[] },
  mode: "reply" | "replyAll",
): { to: string[]; cc: string[] } {
  const isInbound = previousMessage.direction === "inbound";
  // Reply always goes back to whoever sent the message being replied to
  // (them, for an inbound message) or, for an outbound message, back to the
  // same recipients it was originally sent to.
  const primaryTo = dedupeAddresses(isInbound ? [previousMessage.fromAddress] : previousMessage.toAddresses);

  if (mode === "reply") return { to: primaryTo, cc: [] };

  const everyoneElse = isInbound
    ? [previousMessage.fromAddress, ...previousMessage.toAddresses, ...previousMessage.ccAddresses]
    : [...previousMessage.toAddresses, ...previousMessage.ccAddresses];

  const toSet = new Set(primaryTo.map((a) => a.toLowerCase()));
  const addressesToExclude = ourAddresses();
  const cc = dedupeAddresses(everyoneElse).filter(
    (address) => !toSet.has(address.toLowerCase()) && !addressesToExclude.has(address.toLowerCase()),
  );

  return { to: primaryTo, cc };
}

emailThreadsRouter.get("/:id/reply-defaults", async (req, res) => {
  const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id } });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const previousMessage = await prisma.emailMessage.findFirst({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
  });
  if (!previousMessage) {
    return res.status(400).json({ error: "Thread has no prior message to reply to" });
  }

  const mode = req.query.mode === "replyAll" ? "replyAll" : "reply";
  const { to, cc } = computeReplyDefaults(previousMessage, mode);
  const subject = thread.subject.match(/^re:/i) ? thread.subject : `Re: ${thread.subject}`;

  res.json({ to, cc, subject });
});

const composeSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional().default([]),
  subject: z.string().min(1),
  bodyText: z.string().min(1),
  attachments: z.array(attachmentSchema).optional().default([]),
});

emailThreadsRouter.post("/", async (req, res) => {
  if (!env.sesFromAddress || !env.sesSendingDomain) {
    return res.status(400).json({ error: "Email sending is not configured yet — see SETUP.md." });
  }

  const parsed = composeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  let attachments: UploadedAttachment[];
  try {
    attachments = await decodeAndUploadAttachments(parsed.data.attachments);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid attachments" });
  }

  const { contactId, dealId, to, cc, subject, bodyText } = parsed.data;

  const thread = await prisma.emailThread.create({
    data: { contactId, dealId, subject, lastMessageAt: new Date() },
  });

  const message = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      contactId,
      dealId,
      direction: "outbound",
      authorId: req.user.userId,
      rfc822MessageId: `<msg-${randomUUID()}@${env.sesSendingDomain}>`,
      fromAddress: env.sesFromAddress,
      toAddresses: to,
      ccAddresses: cc,
      subject,
      bodyText,
      bodyHtml: textToHtml(bodyText),
      status: "queued",
      attachments: { create: attachments },
    },
  });

  res.status(201).json({ thread, message });
});

const replySchema = z.object({
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  bodyText: z.string().min(1),
  attachments: z.array(attachmentSchema).optional().default([]),
});

emailThreadsRouter.post("/:id/reply", async (req, res) => {
  if (!env.sesFromAddress || !env.sesSendingDomain) {
    return res.status(400).json({ error: "Email sending is not configured yet — see SETUP.md." });
  }

  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id } });
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  const previousMessage = await prisma.emailMessage.findFirst({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
  });
  if (!previousMessage) {
    return res.status(400).json({ error: "Thread has no prior message to reply to" });
  }

  let attachments: UploadedAttachment[];
  try {
    attachments = await decodeAndUploadAttachments(parsed.data.attachments);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid attachments" });
  }

  const defaults = parsed.data.to ? null : computeReplyDefaults(previousMessage, "reply");
  const to = parsed.data.to ?? defaults!.to;
  const cc = parsed.data.cc ?? defaults?.cc ?? [];
  const subject =
    parsed.data.subject ?? (thread.subject.match(/^re:/i) ? thread.subject : `Re: ${thread.subject}`);
  const { bodyText } = parsed.data;

  const [, message] = await prisma.$transaction([
    prisma.emailThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }),
    prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        contactId: thread.contactId,
        dealId: thread.dealId,
        direction: "outbound",
        authorId: req.user.userId,
        rfc822MessageId: `<msg-${randomUUID()}@${env.sesSendingDomain}>`,
        inReplyTo: previousMessage.rfc822MessageId,
        fromAddress: env.sesFromAddress,
        toAddresses: to,
        ccAddresses: cc,
        subject,
        bodyText,
        bodyHtml: textToHtml(bodyText),
        status: "queued",
        attachments: { create: attachments },
      },
    }),
  ]);

  res.status(201).json({ message });
});
