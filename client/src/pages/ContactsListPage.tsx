import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: { id: string; name: string } | null;
}

export function ContactsListPage() {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    setLoading(true);
    api
      .get<{ contacts: ContactSummary[] }>(`/contacts${params}`)
      .then((res) => setContacts(res.contacts))
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <div>
      <header className="page-header">
        <h1>Contacts</h1>
        <div className="actions">
          <Link to="/contacts/import">Import CSV</Link>
          <Link to="/contacts/new" className="primary">
            New Contact
          </Link>
        </div>
      </header>

      <input
        type="search"
        placeholder="Search contacts..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/contacts/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td>{c.email ?? "—"}</td>
                <td>{c.company?.name ?? "—"}</td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={3}>No contacts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
