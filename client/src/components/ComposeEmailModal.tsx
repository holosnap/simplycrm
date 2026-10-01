import { useState, type FormEvent } from "react";
import { Drawer } from "./Drawer";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { fileToBase64, MAX_ATTACHMENTS_BYTES } from "../lib/email";

interface ComposeEmailModalProps {
  contactId?: string;
  dealId?: string;
  replyToThreadId?: string;
  defaultTo?: string[];
  defaultSubject?: string;
  onClose: () => void;
  onSent: () => void;
}

export function ComposeEmailModal({
  contactId,
  dealId,
  replyToThreadId,
  defaultTo = [],
  defaultSubject = "",
  onClose,
  onSent,
}: ComposeEmailModalProps) {
  const { user } = useAuth();
  const [to, setTo] = useState(defaultTo.join(", "));
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyText, setBodyText] = useState(() => (user?.signatureText ? `\n\n${user.signatureText}` : ""));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalAttachmentBytes = files.reduce((sum, f) => sum + f.size, 0);
  const attachmentsTooLarge = totalAttachmentBytes > MAX_ATTACHMENTS_BYTES;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (attachmentsTooLarge) return;

    setSending(true);
    setError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          dataBase64: await fileToBase64(file),
        })),
      );

      const toAddresses = to
        .split(",")
        .map((addr) => addr.trim())
        .filter(Boolean);

      if (replyToThreadId) {
        await api.post(`/email-threads/${replyToThreadId}/reply`, {
          to: toAddresses.length > 0 ? toAddresses : undefined,
          subject: subject || undefined,
          bodyText,
          attachments,
        });
      } else {
        await api.post("/email-threads", {
          contactId: contactId ?? null,
          dealId: dealId ?? null,
          to: toAddresses,
          subject,
          bodyText,
          attachments,
        });
      }

      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to queue email — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Drawer title={replyToThreadId ? "Reply" : "New Email"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="record-form">
        <label>
          To
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com"
            required
          />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          Message
          <textarea rows={10} value={bodyText} onChange={(e) => setBodyText(e.target.value)} required />
        </label>
        <label>
          Attachments
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </label>
        {files.length > 0 && (
          <ul>
            {files.map((file) => (
              <li key={file.name}>
                {file.name} ({(file.size / 1024).toFixed(0)} KB)
              </li>
            ))}
          </ul>
        )}
        {attachmentsTooLarge && (
          <p className="error">
            Attachments total {(totalAttachmentBytes / 1024 / 1024).toFixed(1)}MB, over the{" "}
            {MAX_ATTACHMENTS_BYTES / 1024 / 1024}MB limit.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" disabled={sending || attachmentsTooLarge}>
            {sending ? "Queuing..." : "Send"}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </button>
        </div>
      </form>
    </Drawer>
  );
}
