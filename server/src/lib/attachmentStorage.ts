import { randomUUID } from "node:crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "./s3";
import { env } from "./env";

// file-type v22+ is pure ESM; this server compiles to CommonJS. A literal
// `await import("file-type")` gets down-leveled by tsc into a `require()`
// call under the commonjs module target, which fails for a pure-ESM
// package (confirmed against the real compiled output, not just tsx, which
// has its own loader and would hide this bug). Routing the specifier through
// `new Function` keeps it invisible to that transform, so it stays a real
// native dynamic `import()` at runtime.
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof import("file-type")>;

// Per-file cap; MAX_ATTACHMENTS_BYTES in routes/emailThreads.ts separately
// caps the combined total for one compose/reply (SES's whole-message
// ceiling) — this caps any single file before it ever reaches S3.
export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

export class AttachmentTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(
      `Attachment is ${(sizeBytes / 1024 / 1024).toFixed(1)}MB, over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB limit.`,
    );
    this.name = "AttachmentTooLargeError";
  }
}

export function isAttachmentStorageConfigured(): boolean {
  return Boolean(env.attachmentsS3Bucket);
}

function requireBucket(): string {
  if (!env.attachmentsS3Bucket) {
    throw new Error("Attachment storage is not configured (ATTACHMENTS_S3_BUCKET is unset)");
  }
  return env.attachmentsS3Bucket;
}

// The sender-supplied filename is never trusted beyond display (see
// CLAUDE.md "Never trust the filename from the message") — strip path
// separators and control characters (including CR/LF, which could otherwise
// inject extra headers into the Content-Disposition response) and cap
// length. It's also never used to build the S3 key itself (see
// uploadAttachment), only stored for display and the download filename.
function sanitizeFilename(filename: string): string {
  const stripped = filename
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  const safe = stripped.slice(0, 255);
  return safe.length > 0 ? safe : "attachment";
}

// Sniffs the actual file format from magic bytes — never trust
// `declaredContentType` alone, since it's just whatever the sender's mail
// client (or our own compose request) claimed. Returns null for formats
// file-type doesn't recognize (plain text, CSV, etc.), which is expected and
// not an error.
async function detectContentType(data: Buffer): Promise<string | null> {
  const { fileTypeFromBuffer } = await importEsm("file-type");
  const detected = await fileTypeFromBuffer(data);
  return detected?.mime ?? null;
}

export interface UploadedAttachment {
  filename: string;
  declaredContentType: string;
  detectedContentType: string | null;
  sizeBytes: number;
  s3Key: string;
}

// Uploads one attachment's bytes to S3 and returns only the metadata to
// persist on EmailAttachment — the bytes themselves never touch Postgres
// (CLAUDE.md "store in S3 rather than the database"). The S3 key is always a
// fresh random id, never derived from the sender's filename.
export async function uploadAttachment(input: {
  filename: string;
  declaredContentType: string;
  data: Buffer;
}): Promise<UploadedAttachment> {
  const bucket = requireBucket();
  if (input.data.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(input.data.length);
  }

  const filename = sanitizeFilename(input.filename);
  const detectedContentType = await detectContentType(input.data);
  const s3Key = `email-attachments/${randomUUID()}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: input.data,
      ContentType: detectedContentType ?? input.declaredContentType,
    }),
  );

  return {
    filename,
    declaredContentType: input.declaredContentType,
    detectedContentType,
    sizeBytes: input.data.length,
    s3Key,
  };
}

// Fetches an attachment's raw bytes back out of S3 — used only when building
// outbound raw MIME for a reply that carries attachments (src/lib/emailSend.ts).
// Never exposed directly over the API; downloads go through presigned URLs
// (getAttachmentDownloadUrl) instead.
export async function getAttachmentBytes(s3Key: string): Promise<Buffer> {
  const bucket = requireBucket();
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  if (!response.Body) throw new Error(`S3 object ${s3Key} has no body`);
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

const DOWNLOAD_URL_TTL_SECONDS = 60;

// Short-lived and always forces a download (never inline rendering, which
// would let a malicious attachment execute as HTML/SVG under our origin) —
// the Content-Disposition and Content-Type on the response are both set
// here, overriding whatever's stored on the S3 object itself, and using the
// sniffed type over the sender-declared one when we have it.
export async function getAttachmentDownloadUrl(attachment: {
  s3Key: string;
  filename: string;
  declaredContentType: string;
  detectedContentType: string | null;
}): Promise<string> {
  const bucket = requireBucket();
  const filename = sanitizeFilename(attachment.filename).replace(/"/g, "'");
  const contentType = attachment.detectedContentType ?? attachment.declaredContentType ?? "application/octet-stream";

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: attachment.s3Key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
}
