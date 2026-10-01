import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { EmailBodyRenderer } from "../components/EmailBodyRenderer";
import { ComposeEmailModal } from "../components/ComposeEmailModal";
import { EMAIL_STATUS_LABELS, FAILED_EMAIL_STATUSES } from "../lib/email";

interface Attachment {
  id: string;
  filename: string;
  declaredContentType: string;
  detectedContentType: string | null;
  sizeBytes: number;
}

interface Message {
  id: string;
  direction: "outbound" | "inbound";
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  status: string;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  author: { id: string; name: string } | null;
  attachments: Attachment[];
}

interface ThreadDetail {
  id: string;
  subject: string;
  messages: Message[];
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const [downloading, setDownloading] = useState(false);

  async function handleClick() {
    setDownloading(true);
    try {
      const { url } = await api.get<{ url: string; filename: string }>(
        `/email-attachments/${attachment.id}/download-url`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button type="button" className="secondary" onClick={handleClick} disabled={downloading}>
      {attachment.filename} ({(attachment.sizeBytes / 1024).toFixed(0)} KB)
    </button>
  );
}

export function ThreadViewPage() {
  const { id } = useParams();
  const { refetchThreads } = useOutletContext<{ refetchThreads: () => void }>();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<"reply" | "replyAll" | null>(null);

  const refetch = useCallback(() => {
    if (!id) return Promise.resolve();
    return api
      .get<{ thread: ThreadDetail }>(`/email-threads/${id}`)
      .then((res) => setThread(res.thread))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load thread"));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setThread(null);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  if (!id) return <p className="hint">Select a thread to read it.</p>;
  if (loading) return <p>Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!thread) return null;

  return (
    <div className="thread-view">
      <header className="page-header">
        <h1>{thread.subject}</h1>
        <div className="actions">
          <button type="button" onClick={() => setCompose("reply")}>
            Reply
          </button>
          <button type="button" className="secondary" onClick={() => setCompose("replyAll")}>
            Reply All
          </button>
        </div>
      </header>

      {thread.messages.map((message) => {
        const failed = FAILED_EMAIL_STATUSES.has(message.status);
        const retrying = !failed && Boolean(message.lastError);
        const statusLabel = EMAIL_STATUS_LABELS[message.status] ?? message.status;

        return (
          <article key={message.id} className="email-message">
            <header className="email-message-header">
              <div>
                <strong>{message.direction === "inbound" ? message.fromAddress : message.author?.name ?? "You"}</strong>
                <span className="hint"> to {message.toAddresses.join(", ")}</span>
                {message.ccAddresses.length > 0 && (
                  <span className="hint"> cc {message.ccAddresses.join(", ")}</span>
                )}
              </div>
              <time className="hint">
                {new Date(message.sentAt ?? message.createdAt).toLocaleString()}
              </time>
            </header>

            {message.direction === "outbound" &&
              (failed ? (
                <p className="error">
                  {statusLabel}
                  {message.lastError ? `: ${message.lastError}` : ""}
                </p>
              ) : retrying ? (
                <p className="warning">
                  {statusLabel} (retrying after error: {message.lastError})
                </p>
              ) : (
                <p className="hint">{statusLabel}</p>
              ))}

            <EmailBodyRenderer bodyHtml={message.bodyHtml} bodyText={message.bodyText} />

            {message.attachments.length > 0 && (
              <div className="email-attachments">
                {message.attachments.map((attachment) => (
                  <AttachmentLink key={attachment.id} attachment={attachment} />
                ))}
              </div>
            )}
          </article>
        );
      })}

      {compose && (
        <ComposeEmailModal
          replyToThreadId={thread.id}
          replyMode={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            refetch();
            refetchThreads();
          }}
        />
      )}
    </div>
  );
}
