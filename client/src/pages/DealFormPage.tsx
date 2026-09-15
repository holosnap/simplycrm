import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from "../lib/deals";

interface ContactOption {
  id: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
}

export function DealFormPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<DealStage>("prospecting");
  const [contactId, setContactId] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  useEffect(() => {
    api.get<{ contacts: ContactOption[] }>("/contacts?pageSize=500").then((res) =>
      setContacts(res.contacts),
    );
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const contact = contacts.find((c) => c.id === contactId);
    const { deal } = await api.post<{ deal: { id: string } }>("/deals", {
      title,
      amount: Number(amount),
      stage,
      contactId: contactId || null,
      companyId: contact?.companyId ?? null,
      expectedCloseDate: expectedCloseDate || null,
    });
    navigate(`/deals/${deal.id}`);
  }

  return (
    <div>
      <h1>New Deal</h1>
      <form onSubmit={handleSubmit} className="record-form">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Amount (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {DEAL_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contact
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— None —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected close date
          <input
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
