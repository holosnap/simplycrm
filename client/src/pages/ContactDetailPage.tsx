import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { DEAL_STAGE_LABELS, formatCurrency, type DealStage } from "../lib/deals";

interface Activity {
  id: string;
  type: "note" | "call" | "email" | "meeting";
  body: string;
  occurredAt: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  activities: Activity[];
  tasks: { id: string; title: string; status: "open" | "done" }[];
  deals: { id: string; title: string; amount: string; stage: DealStage }[];
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [note, setNote] = useState("");

  function refresh() {
    if (!id) return;
    api.get<{ contact: Contact }>(`/contacts/${id}`).then((res) => setContact(res.contact));
  }

  useEffect(refresh, [id]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!id || !note.trim()) return;
    await api.post(`/contacts/${id}/activity`, { type: "note", body: note });
    setNote("");
    refresh();
  }

  if (!contact) return <p>Loading...</p>;

  return (
    <div>
      <header className="page-header">
        <h1>
          {contact.firstName} {contact.lastName}
        </h1>
      </header>

      <section>
        <p>Email: {contact.email ?? "—"}</p>
        <p>Phone: {contact.phone ?? "—"}</p>
        <p>Title: {contact.title ?? "—"}</p>
        <p>Company: {contact.company?.name ?? "—"}</p>
        <p>Tags: {contact.tags.map((t) => t.tag.name).join(", ") || "—"}</p>
      </section>

      <section>
        <h2>Deals</h2>
        <ul>
          {contact.deals.map((deal) => (
            <li key={deal.id}>
              <Link to={`/deals/${deal.id}`}>{deal.title}</Link> —{" "}
              {formatCurrency(deal.amount)} ({DEAL_STAGE_LABELS[deal.stage]})
            </li>
          ))}
          {contact.deals.length === 0 && <li>No deals.</li>}
        </ul>
      </section>

      <section>
        <h2>Open Tasks</h2>
        <ul>
          {contact.tasks
            .filter((t) => t.status === "open")
            .map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
        </ul>
      </section>

      <section>
        <h2>Activity</h2>
        <form onSubmit={addNote}>
          <textarea
            placeholder="Add a note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit">Add note</button>
        </form>
        <ul>
          {contact.activities.map((entry) => (
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
