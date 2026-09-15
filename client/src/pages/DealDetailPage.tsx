import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { DEAL_STAGES, DEAL_STAGE_LABELS, formatCurrency, type DealStage } from "../lib/deals";

interface Activity {
  id: string;
  type: "note" | "call" | "email" | "meeting";
  body: string;
  occurredAt: string;
}

interface Deal {
  id: string;
  title: string;
  amount: string;
  stage: DealStage;
  expectedCloseDate: string | null;
  company: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; name: string } | null;
  activities: Activity[];
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [note, setNote] = useState("");

  function refresh() {
    if (!id) return;
    api.get<{ deal: Deal }>(`/deals/${id}`).then((res) => setDeal(res.deal));
  }

  useEffect(refresh, [id]);

  async function changeStage(stage: DealStage) {
    if (!id) return;
    await api.patch(`/deals/${id}`, { stage });
    refresh();
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!id || !note.trim()) return;
    await api.post(`/deals/${id}/activity`, { type: "note", body: note });
    setNote("");
    refresh();
  }

  if (!deal) return <p>Loading...</p>;

  return (
    <div>
      <header className="page-header">
        <h1>{deal.title}</h1>
      </header>

      <section>
        <p>Amount: {formatCurrency(deal.amount)}</p>
        <p>
          Stage:{" "}
          <select value={deal.stage} onChange={(e) => changeStage(e.target.value as DealStage)}>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {DEAL_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </p>
        <p>
          Company:{" "}
          {deal.company ? <Link to={`/companies/${deal.company.id}`}>{deal.company.name}</Link> : "—"}
        </p>
        <p>
          Contact:{" "}
          {deal.contact ? (
            <Link to={`/contacts/${deal.contact.id}`}>
              {deal.contact.firstName} {deal.contact.lastName}
            </Link>
          ) : (
            "—"
          )}
        </p>
        <p>Owner: {deal.owner?.name ?? "—"}</p>
        <p>
          Expected close:{" "}
          {deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : "—"}
        </p>
      </section>

      <section>
        <h2>Activity</h2>
        {deal.contact ? (
          <form onSubmit={addNote}>
            <textarea
              placeholder="Add a note..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="submit">Add note</button>
          </form>
        ) : (
          <p className="hint">Link a contact to this deal to log activity.</p>
        )}
        <ul>
          {deal.activities.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.type}</strong> — {entry.body} (
              {new Date(entry.occurredAt).toLocaleString()})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
