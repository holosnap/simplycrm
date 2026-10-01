import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

interface Tag {
  id: string;
  name: string;
}

interface EmailHealth {
  configured: boolean;
  message?: string;
  checkedAt?: string;
  error?: string;
  account?: {
    sendingEnabled: boolean;
    productionAccessEnabled: boolean;
    enforcementStatus?: string;
    suppressedReasons: string[];
  };
  identity?: {
    name: string;
    verifiedForSendingStatus: boolean;
    verificationStatus?: string;
    configurationSetName?: string;
    dkim: {
      status?: string;
      signingEnabled: boolean;
      tokens: string[];
    };
  };
}

function EmailHealthCheck() {
  const [health, setHealth] = useState<EmailHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function checkConnection() {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await api.get<EmailHealth>("/email/health");
      setHealth(result);
    } catch (err) {
      setCheckError(err instanceof ApiError ? err.message : "Failed to reach the server.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section>
      <h2>Email (AWS SES)</h2>
      <div className="form-actions">
        <button type="button" onClick={checkConnection} disabled={checking}>
          {checking ? "Checking..." : "Check connection"}
        </button>
      </div>

      {checkError && <p className="error">{checkError}</p>}

      {health && !health.configured && (
        <p className="hint">{health.message ?? "AWS SES is not configured yet."}</p>
      )}

      {health?.configured && health.error && (
        <p className="error">AWS SES call failed: {health.error}</p>
      )}

      {health?.configured && health.account && health.identity && (
        <table>
          <tbody>
            <tr>
              <td>Account sending enabled</td>
              <td>{health.account.sendingEnabled ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>Production access</td>
              <td>{health.account.productionAccessEnabled ? "Yes" : "No (sandbox)"}</td>
            </tr>
            <tr>
              <td>Account suppression list</td>
              <td>{health.account.suppressedReasons.join(", ") || "none"}</td>
            </tr>
            <tr>
              <td>Identity</td>
              <td>{health.identity.name}</td>
            </tr>
            <tr>
              <td>Identity verified for sending</td>
              <td>{health.identity.verifiedForSendingStatus ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>Verification status</td>
              <td>{health.identity.verificationStatus ?? "—"}</td>
            </tr>
            <tr>
              <td>DKIM status</td>
              <td>{health.identity.dkim.status ?? "—"}</td>
            </tr>
            <tr>
              <td>Configuration set</td>
              <td>{health.identity.configurationSetName ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AdminSettingsPage() {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    api.get<{ tags: Tag[] }>("/tags").then((res) => setTags(res.tags));
  }, []);

  return (
    <div>
      <h1>Tags & Custom Fields</h1>
      <section>
        <h2>Tags</h2>
        <ul>
          {tags.map((tag) => (
            <li key={tag.id}>{tag.name}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Custom Fields</h2>
        <p className="hint">Custom field management UI is not yet implemented.</p>
      </section>
      <EmailHealthCheck />
    </div>
  );
}
