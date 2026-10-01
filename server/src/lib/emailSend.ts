import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import MailComposer from "nodemailer/lib/mail-composer";
import type { EmailAttachment, EmailMessage } from "@prisma/client";
import { sesClient } from "./ses";
import { prisma } from "./prisma";
import { env } from "./env";
import { getAttachmentBytes } from "./attachmentStorage";

export type QueuedEmailMessage = EmailMessage & { attachments: EmailAttachment[] };

// RFC 5322 References is the ordered chain of every prior Message-ID in the
// thread, not just the immediate parent — derived fresh from the thread's
// own message history (rather than stored as a separate column) so it can
// never drift out of sync with what's actually in the thread.
async function buildReferences(message: QueuedEmailMessage): Promise<string[]> {
  if (!message.inReplyTo) return [];

  const priorMessages = await prisma.emailMessage.findMany({
    where: { threadId: message.threadId, createdAt: { lt: message.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { rfc822MessageId: true },
  });
  return priorMessages.map((m) => m.rfc822MessageId);
}

// Replies always carry In-Reply-To/References, and those are exactly the
// kind of custom headers Simple content doesn't give us fine-grained control
// over here — so, per spec, every reply (not just ones with attachments)
// goes through the Raw/MIME path.
function needsRawMime(message: QueuedEmailMessage, references: string[]): boolean {
  return message.attachments.length > 0 || Boolean(message.inReplyTo) || references.length > 0;
}

async function buildRawMime(message: QueuedEmailMessage, references: string[]): Promise<Buffer> {
  // Attachment bytes live in S3, not on the row (see CLAUDE.md "Email
  // attachments") — fetch each one back out before handing it to
  // MailComposer. Uses the sniffed content type when we have one, same as
  // the download path, rather than trusting what the sender/compose request
  // originally declared.
  const attachments = await Promise.all(
    message.attachments.map(async (attachment) => ({
      filename: attachment.filename,
      content: await getAttachmentBytes(attachment.s3Key),
      contentType: attachment.detectedContentType ?? attachment.declaredContentType,
    })),
  );

  return new Promise((resolve, reject) => {
    const composer = new MailComposer({
      from: message.fromAddress,
      to: message.toAddresses,
      cc: message.ccAddresses.length > 0 ? message.ccAddresses : undefined,
      subject: message.subject,
      messageId: message.rfc822MessageId,
      inReplyTo: message.inReplyTo ?? undefined,
      references: references.length > 0 ? references : undefined,
      text: message.bodyText ?? undefined,
      html: message.bodyHtml ?? undefined,
      attachments,
    });

    composer.compile().build((err, builtMessage) => {
      if (err) reject(err);
      else resolve(builtMessage);
    });
  });
}

export async function sendQueuedEmail(message: QueuedEmailMessage): Promise<{ sesMessageId: string }> {
  if (!env.sesConfigurationSet) {
    throw new Error("SES_CONFIGURATION_SET is not configured — see SETUP.md");
  }

  const references = await buildReferences(message);
  const useRaw = needsRawMime(message, references);

  // Carries our own id so SES events can be correlated back without relying
  // on MessageId alone (e.g. if we haven't persisted the MessageId yet when
  // an event arrives). EmailTags values are restricted to [A-Za-z0-9_-], a
  // UUID satisfies that.
  const emailTags = [{ Name: "simplycrm_message_id", Value: message.id }];

  const response = await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: message.fromAddress,
      Destination: {
        ToAddresses: message.toAddresses,
        CcAddresses: message.ccAddresses.length > 0 ? message.ccAddresses : undefined,
      },
      ConfigurationSetName: env.sesConfigurationSet,
      EmailTags: emailTags,
      Content: useRaw
        ? { Raw: { Data: await buildRawMime(message, references) } }
        : {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: message.bodyText ? { Data: message.bodyText, Charset: "UTF-8" } : undefined,
                Html: message.bodyHtml ? { Data: message.bodyHtml, Charset: "UTF-8" } : undefined,
              },
            },
          },
    }),
  );

  if (!response.MessageId) {
    throw new Error("SES accepted the send but returned no MessageId");
  }
  return { sesMessageId: response.MessageId };
}
