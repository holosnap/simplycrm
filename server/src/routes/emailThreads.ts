import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { publicUserSelect } from "../lib/publicUser";

export const emailThreadsRouter = Router();

// SES's hard ceiling is 10MB for the whole encoded message. Base64 inflates
// raw bytes by ~4/3, and MIME multipart framing adds a bit more on top, so
// this caps well under that rather than letting SES reject it opaquely at
// send time.
const MAX_ATTACHMENTS_BYTES = 7 * 1024 * 1024;

const attachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  dataBase64: z.string().min(1),
});

function decodeAttachments(input: z.infer<typeof attachmentSchema>[]) {
  let totalBytes = 0;
  const decoded = input.map((attachment) => {
    const data = Buffer.from(attachment.dataBase64, "base64");
    totalBytes += data.length;
    return { filename: attachment.filename, contentType: attachment.contentType, data };
  });
  if (totalBytes > MAX_ATTACHMENTS_BYTES) {
    const error = new Error(
      `Attachments total ${(totalBytes / 1024 / 1024).toFixed(1)}MB, over the ${MAX_ATTACHMENTS_BYTES / 1024 / 1024}MB limit.`,
    );
    error.name = "AttachmentsTooLarge";
    throw error;
  }
  return decoded;
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
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, direction: true, subject: true, sentAt: true, lastError: true },
  },
};

emailThreadsRouter.get("/", async (req, res) => {
  const { contactId, dealId } = req.query;
  if (!contactId && !dealId) {
    return res.status(400).json({ error: "contactId or dealId is required" });
  }

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
          attachments: { select: { id: true, filename: true, contentType: true } },
        },
      },
    },
  });
  if (!thread) return res.status(404).json({ error: "Thread not found" });
  res.json({ thread });
});

const composeSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  to: z.array(z.string().email()).min(1),
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

  let attachments;
  try {
    attachments = decodeAttachments(parsed.data.attachments);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid attachments" });
  }

  const { contactId, dealId, to, subject, bodyText } = parsed.data;

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

  let attachments;
  try {
    attachments = decodeAttachments(parsed.data.attachments);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid attachments" });
  }

  const to = parsed.data.to ?? previousMessage.toAddresses;
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
