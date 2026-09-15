import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function CompanyFormPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { company } = await api.post<{ company: { id: string } }>("/companies", {
      name,
      domain: domain || null,
    });
    navigate(`/companies/${company.id}`);
  }

  return (
    <div>
      <h1>New Company</h1>
      <form onSubmit={handleSubmit} className="record-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Domain
          <input value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
