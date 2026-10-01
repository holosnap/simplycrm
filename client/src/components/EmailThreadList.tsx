import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { ComposeEmailModal } from "./ComposeEmailModal";
import { EMAIL_STATUS_LABELS, FAILED_EMAIL_STATUSES } from "../lib/email";

interface ThreadMessageSummary {
  status: string;
  direction: "outbound" | "inbound";
  sentAt: string | null;
  lastError: string | null;
}

interface ThreadSummary {
  id: string;
  subject: string;
  lastMessageAt: string | null;
  messages: ThreadMessageSummary[];
}

interface EmailThreadListProps {
  contactId?: string;
  dealId?: string;
  defaultTo?: string[];
}

const PENDING_STATUSES = new Set(["queued", "sending"]);

export function EmailThreadList({ contactId, dealId, defaultTo = [] }: EmailThreadListProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [compose, setCompose] = useState<{ threadId?: string; replyMode?: "reply" | "replyAll" } | null>(null);

  const refetch = useCallback(() => {
    // dealId takes priority: on a Deal page, contactId may also be passed
    // (so new messages denormalize it), but the list itself should be this
    // deal's threads, not every thread for its linked contact.
    const params = dealId ? `dealId=${dealId}` : `contactId=${contactId}`;
    api.get<{ threads: ThreadSummary[] }>(`/email-threads?${params}`).then((res) => setThreads(res.threads));
  }, [contactId, dealId]);

  useEffect(refetch, [refetch]);

  // A send isn't resolved the instant it's queued — it's picked up and
  // retried by the background worker. Poll while anything is still pending
  // so a later failure (or success) shows up without the user having to
  // close and reopen this panel; stop once nothing is left in flight.
  const hasPending = threads.some((t) => PENDING_STATUSES.has(t.messages[0]?.status ?? ""));
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(refetch, 3000);
    return () => clearInterval(interval);
  }, [hasPending, refetch]);

  return (
    <section>
      <h2>Email</h2>
      <div className="form-actions">
        <button type="button" onClick={() => setCompose({})}>
          New Email
        </button>
      </div>

      <ul>
        {threads.map((thread) => {
          const latest = thread.messages[0] as ThreadMessageSummary | undefined;
          const failed = Boolean(latest && FAILED_EMAIL_STATUSES.has(latest.status));
          // A message can still be "queued" for retry after a failed attempt
          // (lastError set, status not yet terminal) — that's not a silent
          // success, so it gets the same visible treatment as a hard failure,
          // just worded as still-retrying rather than given up on.
          const retrying = Boolean(latest && !failed && latest.lastError);
          const statusLabel = latest ? (EMAIL_STATUS_LABELS[latest.status] ?? latest.status) : null;

          return (
            <li key={thread.id}>
              <strong>{thread.subject}</strong>
              {statusLabel &&
                (failed ? (
                  <span className="error">
                    {" — "}
                    {statusLabel}
                    {latest?.lastError ? `: ${latest.lastError}` : ""}
                  </span>
                ) : retrying ? (
                  <span className="warning">
                    {" — "}
                    {statusLabel} (retrying after error: {latest?.lastError})
                  </span>
                ) : (
                  <span>{` — ${statusLabel}`}</span>
                ))}
              {thread.lastMessageAt && <span>{` (${new Date(thread.lastMessageAt).toLocaleString()})`}</span>}{" "}
              <button type="button" onClick={() => setCompose({ threadId: thread.id, replyMode: "reply" })}>
                Reply
              </button>{" "}
              <button
                type="button"
                className="secondary"
                onClick={() => setCompose({ threadId: thread.id, replyMode: "replyAll" })}
              >
                Reply All
              </button>
            </li>
          );
        })}
        {threads.length === 0 && <li>No emails yet.</li>}
      </ul>

      {compose && (
        <ComposeEmailModal
          contactId={contactId}
          dealId={dealId}
          replyToThreadId={compose.threadId}
          replyMode={compose.replyMode}
          defaultTo={compose.threadId ? undefined : defaultTo}
          onClose={() => setCompose(null)}
          onSent={refetch}
        />
      )}
    </section>
  );
}
