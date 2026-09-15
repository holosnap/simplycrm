import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  notes: string | null;
  contacts: { id: string; firstName: string; lastName: string }[];
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
      </ul>
    </div>
  );
}
