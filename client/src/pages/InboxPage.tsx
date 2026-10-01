import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { EMAIL_STATUS_LABELS, FAILED_EMAIL_STATUSES } from "../lib/email";

interface ThreadMessageSummary {
  status: string;
  direction: "outbound" | "inbound";
  fromAddress: string;
  sentAt: string | null;
  lastError: string | null;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  lastMessageAt: string | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  deal: { id: string; title: string } | null;
  messages: ThreadMessageSummary[];
}

const PENDING_STATUSES = new Set(["queued", "sending"]);

export function InboxPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { id: selectedId } = useParams();

  const refetch = useCallback(
    () => api.get<{ threads: ThreadSummary[] }>("/email-threads").then((res) => setThreads(res.threads)),
    [],
  );

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  const hasPending = threads.some((t) => PENDING_STATUSES.has(t.messages[0]?.status ?? ""));
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(refetch, 3000);
    return () => clearInterval(interval);
  }, [hasPending, refetch]);

  return (
    <div className="inbox-layout">
      <div className="inbox-list-pane">
        <header className="page-header">
          <h1>Inbox</h1>
        </header>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <ul className="inbox-thread-list">
            {threads.map((thread) => {
              const latest = thread.messages[0] as ThreadMessageSummary | undefined;
              const failed = Boolean(latest && FAILED_EMAIL_STATUSES.has(latest.status));
              const statusLabel = latest ? (EMAIL_STATUS_LABELS[latest.status] ?? latest.status) : null;

              return (
                <li key={thread.id}>
                  <Link
                    to={`/inbox/${thread.id}`}
                    className={`inbox-thread-link${thread.id === selectedId ? " active" : ""}`}
                  >
                    <div className="inbox-thread-subject">{thread.subject}</div>
                    <div className="inbox-thread-meta">
                      {thread.contact ? `${thread.contact.firstName} ${thread.contact.lastName}` : latest?.fromAddress}
                      {thread.deal ? ` · ${thread.deal.title}` : ""}
                    </div>
                    <div className="inbox-thread-meta">
                      {statusLabel && <span className={failed ? "error" : undefined}>{statusLabel}</span>}
                      {thread.lastMessageAt && <span> · {new Date(thread.lastMessageAt).toLocaleString()}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
            {threads.length === 0 && <li className="hint">No email yet.</li>}
          </ul>
        )}
      </div>

      <div className="inbox-thread-pane">
        <Outlet context={{ refetchThreads: refetch }} />
      </div>
    </div>
  );
}
