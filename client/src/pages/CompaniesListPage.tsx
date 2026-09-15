import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface CompanySummary {
  id: string;
  name: string;
  domain: string | null;
  _count: { contacts: number };
}

export function CompaniesListPage() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);

  useEffect(() => {
    api.get<{ companies: CompanySummary[] }>("/companies").then((res) => setCompanies(res.companies));
  }, []);

  return (
    <div>
      <header className="page-header">
        <h1>Companies</h1>
        <Link to="/companies/new" className="primary">
          New Company
        </Link>
      </header>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Domain</th>
            <th>Contacts</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/companies/${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.domain ?? "—"}</td>
              <td>{c._count.contacts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
