import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { DEAL_STAGE_LABELS, formatCurrency, type DealStage } from "../lib/deals";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  notes: string | null;
  contacts: { id: string; firstName: string; lastName: string }[];
  deals: { id: string; title: string; amount: string; stage: DealStage }[];
}

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<{ company: Company }>(`/companies/${id}`).then((res) => setCompany(res.company));
  }, [id]);

  if (!company) return <p>Loading...</p>;

  return (
    <div>
      <header className="page-header">
        <h1>{company.name}</h1>
      </header>
      <p>Domain: {company.domain ?? "—"}</p>
      <p>Notes: {company.notes ?? "—"}</p>

      <h2>Contacts</h2>
      <ul>
        {company.contacts.map((c) => (
          <li key={c.id}>
            <Link to={`/contacts/${c.id}`}>
              {c.firstName} {c.lastName}
            </Link>
          </li>
        ))}
        {company.contacts.length === 0 && <li>No contacts.</li>}
      </ul>

      <h2>Deals</h2>
      <ul>
        {company.deals.map((deal) => (
          <li key={deal.id}>
            <Link to={`/deals/${deal.id}`}>{deal.title}</Link> — {formatCurrency(deal.amount)} (
            {DEAL_STAGE_LABELS[deal.stage]})
          </li>
        ))}
        {company.deals.length === 0 && <li>No deals.</li>}
      </ul>
    </div>
  );
}
