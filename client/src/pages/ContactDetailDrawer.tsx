import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Drawer } from "../components/Drawer";
import { ContactForm } from "../components/ContactForm";
import { api, ApiError } from "../lib/api";
import { toContactApiPayload, type ContactFormValues } from "../lib/schemas/contact";
import { DEAL_STAGE_LABELS, formatCurrency, type DealStage } from "../lib/deals";
import { useContactsOutletContext } from "./contactsOutletContext";

interface Activity {
  id: string;
  type: "note" | "call" | "email" | "meeting";
  body: string;
  occurredAt: string;
}

interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  activities: Activity[];
  tasks: { id: string; title: string; status: "open" | "done" }[];
  deals: { id: string; title: string; amount: string; stage: DealStage }[];
}

export function ContactDetailDrawer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setContacts, refetch } = useContactsOutletContext();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function refresh() {
    if (!id) return;
    api.get<{ contact: ContactDetail }>(`/contacts/${id}`).then((res) => setContact(res.contact));
  }

  useEffect(() => {
    setMode("view");
    refresh();
  }, [id]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!id || !note.trim()) return;
    await api.post(`/contacts/${id}/activity`, { type: "note", body: note });
    setNote("");
    refresh();
  }

  async function handleSave(values: ContactFormValues) {
    if (!id) return;
    await api.patch(`/contacts/${id}`, toContactApiPayload(values));
    setMode("view");
    refresh();
    refetch();
  }

  async function handleDelete() {
    if (!id || !window.confirm("Delete this contact? This cannot be undone.")) return;

    setDeleteError(null);
    setDeleting(true);
    // Optimistic: remove the row from the table immediately.
    setContacts((prev) => prev.filter((c) => c.id !== id));

    try {
      await api.delete(`/contacts/${id}`);
      navigate("/contacts");
    } catch (err) {
      // Roll back — put the row back and let the user know.
      refetch();
      setDeleteError(err instanceof ApiError ? err.message : "Failed to delete contact.");
      setDeleting(false);
    }
  }

  function close() {
    navigate("/contacts");
  }

  if (!contact) {
    return (
      <Drawer title="Contact" onClose={close}>
        <p>Loading...</p>
      </Drawer>
    );
  }

  if (mode === "edit") {
    return (
      <Drawer title={`Edit ${contact.firstName} ${contact.lastName}`} onClose={close}>
        <ContactForm
          initialValues={{
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            title: contact.title ?? "",
            companyId: contact.company?.id ?? "",
            ownerId: contact.owner?.id ?? "",
          }}
          submitLabel="Save changes"
          onSubmit={handleSave}
          onCancel={() => setMode("view")}
        />
      </Drawer>
    );
  }

  return (
    <Drawer title={`${contact.firstName} ${contact.lastName}`} onClose={close}>
      <section>
        <p>Email: {contact.email ?? "—"}</p>
        <p>Phone: {contact.phone ?? "—"}</p>
        <p>Title: {contact.title ?? "—"}</p>
        <p>
          Company:{" "}
          {contact.company ? (
            <Link to={`/companies/${contact.company.id}`}>{contact.company.name}</Link>
          ) : (
            "—"
          )}
        </p>
        <p>Owner: {contact.owner?.name ?? "—"}</p>
        <p>Tags: {contact.tags.map((t) => t.tag.name).join(", ") || "—"}</p>
      </section>

      <div className="form-actions">
        <button type="button" onClick={() => setMode("edit")}>
          Edit
        </button>
        <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
      {deleteError && <p className="error">{deleteError}</p>}

      <section>
        <h2>Deals</h2>
        <ul>
          {contact.deals.map((deal) => (
            <li key={deal.id}>
              <Link to={`/deals/${deal.id}`}>{deal.title}</Link> — {formatCurrency(deal.amount)} (
              {DEAL_STAGE_LABELS[deal.stage]})
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
          {contact.tasks.filter((t) => t.status === "open").length === 0 && <li>No open tasks.</li>}
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
    </Drawer>
  );
}
