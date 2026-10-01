import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";

export function MyAccountPage() {
  const { user, updateUser } = useAuth();
  const [signatureText, setSignatureText] = useState(user?.signatureText ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSaveSignature(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const { user: updated } = await api.patch<{ user: { signatureText: string | null } }>("/me", {
        signatureText: signatureText || null,
      });
      updateUser({ signatureText: updated.signatureText });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save signature.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>My Account</h1>
      <p>Name: {user?.name}</p>
      <p>Email: {user?.email}</p>
      <p className="hint">Change-password form is not yet implemented.</p>

      <section>
        <h2>Email Signature</h2>
        <p className="hint">Appended when you compose a new email from a contact or deal.</p>
        <form onSubmit={handleSaveSignature} className="record-form">
          <label>
            Signature
            <textarea
              rows={4}
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
            />
          </label>
          {saveError && <p className="error">{saveError}</p>}
          {saved && !saveError && <p className="hint">Saved.</p>}
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save signature"}
          </button>
        </form>
      </section>
    </div>
  );
}
