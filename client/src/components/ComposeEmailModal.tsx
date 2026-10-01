import { useEffect, useState, type FormEvent } from "react";
import { Drawer } from "./Drawer";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { fileToBase64, MAX_ATTACHMENTS_BYTES } from "../lib/email";

interface ComposeEmailModalProps {
  contactId?: string;
  dealId?: string;
  replyToThreadId?: string;
  // Only meaningful alongside replyToThreadId and no defaultTo — which
  // addresses count as "ours" (to exclude) isn't something the client knows,
  // so the actual To/Cc are fetched from the server (see the effect below).
  replyMode?: "reply" | "replyAll";
  defaultTo?: string[];
  defaultSubject?: string;
  onClose: () => void;
  onSent: () => void;
}

export function ComposeEmailModal({
  contactId,
  dealId,
  replyToThreadId,
  replyMode = "reply",
  defaultTo = [],
  defaultSubject = "",
  onClose,
  onSent,
}: ComposeEmailModalProps) {
  const { user } = useAuth();
  const [to, setTo] = useState(defaultTo.join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyText, setBodyText] = useState(() => (user?.signatureText ? `\n\n${user.signatureText}` : ""));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDefaults, setLoadingDefaults] = useState(Boolean(replyToThreadId) && defaultTo.length === 0);

  useEffect(() => {
    if (!replyToThreadId || defaultTo.length > 0) return;
    let cancelled = false;
    api
      .get<{ to: string[]; cc: string[]; subject: string }>(
        `/email-threads/${replyToThreadId}/reply-defaults?mode=${replyMode}`,
      )
      .then((res) => {
        if (cancelled) return;
        setTo(res.to.join(", "));
        setCc(res.cc.join(", "));
        setSubject((current) => current || res.subject);
      })
      .catch(() => {
        // The reply still works with an empty To — the user can type the
        // recipient in by hand, same as before this endpoint existed.
      })
      .finally(() => {
        if (!cancelled) setLoadingDefaults(false);
      });
    return () => {
      cancelled = true;
    };
  }, [replyToThreadId, replyMode]); // intentionally excludes defaultTo — only its initial length matters

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

      const splitAddresses = (value: string) =>
        value
          .split(",")
          .map((addr) => addr.trim())
          .filter(Boolean);
      const toAddresses = splitAddresses(to);
      const ccAddresses = splitAddresses(cc);

      if (replyToThreadId) {
        await api.post(`/email-threads/${replyToThreadId}/reply`, {
          to: toAddresses.length > 0 ? toAddresses : undefined,
          cc: ccAddresses,
          subject: subject || undefined,
          bodyText,
          attachments,
        });
      } else {
        await api.post("/email-threads", {
          contactId: contactId ?? null,
          dealId: dealId ?? null,
          to: toAddresses,
          cc: ccAddresses,
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
          Cc
          <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" />
        </label>
        {loadingDefaults && <p className="hint">Loading recipients...</p>}
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
