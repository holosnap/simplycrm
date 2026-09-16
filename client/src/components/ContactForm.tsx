import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import {
  contactFormSchema,
  validateContactForm,
  type ContactFormErrors,
  type ContactFormValues,
} from "../lib/schemas/contact";

interface CompanyOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
}

interface ContactFormProps {
  initialValues: ContactFormValues;
  submitLabel: string;
  onSubmit: (values: ContactFormValues) => Promise<void>;
  onCancel: () => void;
}

export function ContactForm({ initialValues, submitLabel, onSubmit, onCancel }: ContactFormProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ companies: CompanyOption[] }>("/companies").then((res) => setCompanies(res.companies));
    api.get<{ users: UserOption[] }>("/directory/users").then((res) => setUsers(res.users));
  }, []);

  function setField<K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationErrors = validateContactForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit(contactFormSchema.parse(values));
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="record-form">
      <label>
        First name
        <input
          value={values.firstName}
          onChange={(e) => setField("firstName", e.target.value)}
          aria-invalid={Boolean(errors.firstName)}
        />
        {errors.firstName && <span className="field-error">{errors.firstName}</span>}
      </label>

      <label>
        Last name
        <input
          value={values.lastName}
          onChange={(e) => setField("lastName", e.target.value)}
          aria-invalid={Boolean(errors.lastName)}
        />
        {errors.lastName && <span className="field-error">{errors.lastName}</span>}
      </label>

      <label>
        Email
        <input
          type="email"
          value={values.email}
          onChange={(e) => setField("email", e.target.value)}
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email && <span className="field-error">{errors.email}</span>}
      </label>

      <label>
        Phone
        <input value={values.phone} onChange={(e) => setField("phone", e.target.value)} />
      </label>

      <label>
        Title
        <input value={values.title} onChange={(e) => setField("title", e.target.value)} />
      </label>

      <label>
        Company
        <select value={values.companyId} onChange={(e) => setField("companyId", e.target.value)}>
          <option value="">— None —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Owner
        <select value={values.ownerId} onChange={(e) => setField("ownerId", e.target.value)}>
          <option value="">— Unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>

      {submitError && <p className="error">{submitError}</p>}

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
