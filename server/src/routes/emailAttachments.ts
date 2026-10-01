import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getAttachmentDownloadUrl } from "../lib/attachmentStorage";

export const emailAttachmentsRouter = Router();

// Returns a short-lived presigned URL rather than streaming the file itself —
// the client's auth header is a JWT it can't attach to a plain navigation,
// so it calls this authenticated JSON endpoint first, then navigates to the
// presigned URL (which is itself the authorization for that one GET).
emailAttachmentsRouter.get("/:id/download-url", async (req, res) => {
  const attachment = await prisma.emailAttachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });

  const url = await getAttachmentDownloadUrl(attachment);
  res.json({ url, filename: attachment.filename });
});
