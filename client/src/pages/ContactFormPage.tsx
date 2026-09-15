import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function ContactFormPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { contact } = await api.post<{ contact: { id: string } }>("/contacts", {
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
    });
    navigate(`/contacts/${contact.id}`);
  }

  return (
    <div>
      <h1>New Contact</h1>
      <form onSubmit={handleSubmit} className="record-form">
        <label>
          First name
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
        <label>
          Last name
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
