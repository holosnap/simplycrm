import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { ContactSummary } from "./contactsOutletContext";

export function ContactsListPage() {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const fetchContacts = useCallback(() => {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    setLoading(true);
    return api
      .get<{ contacts: ContactSummary[] }>(`/contacts${params}`)
      .then((res) => setContacts(res.contacts))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const drawerOpen = location.pathname !== "/contacts";

  return (
    <div className={drawerOpen ? "list-with-drawer" : undefined}>
      <div className="list-main">
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
                <th>Owner</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  className="clickable-row"
                  onClick={() => navigate(`/contacts/${c.id}`)}
                >
                  <td>
                    <Link to={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()}>
                      {c.firstName} {c.lastName}
                    </Link>
                  </td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.company?.name ?? "—"}</td>
                  <td>{c.owner?.name ?? "—"}</td>
                  <td>{c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={5}>No contacts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Outlet context={{ contacts, setContacts, refetch: fetchContacts }} />
    </div>
  );
}
