export const EMAIL_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complaint",
  failed: "Failed",
};

export const FAILED_EMAIL_STATUSES = new Set(["failed", "bounced", "complained"]);

// Mirrors MAX_ATTACHMENTS_BYTES in server/src/routes/emailThreads.ts — keep in sync.
export const MAX_ATTACHMENTS_BYTES = 7 * 1024 * 1024;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
