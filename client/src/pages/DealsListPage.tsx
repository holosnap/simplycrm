import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { DEAL_STAGES, DEAL_STAGE_LABELS, formatCurrency, type DealStage } from "../lib/deals";

interface DealSummary {
  id: string;
  title: string;
  amount: string;
  stage: DealStage;
  company: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; name: string } | null;
}

export function DealsListPage() {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [stageFilter, setStageFilter] = useState<DealStage | "">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = stageFilter ? `?stage=${stageFilter}` : "";
    setLoading(true);
    api
      .get<{ deals: DealSummary[] }>(`/deals${params}`)
      .then((res) => setDeals(res.deals))
      .finally(() => setLoading(false));
  }, [stageFilter]);

  return (
    <div>
      <header className="page-header">
        <h1>Deals</h1>
        <Link to="/deals/new" className="primary">
          New Deal
        </Link>
      </header>

      <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as DealStage | "")}>
        <option value="">All stages</option>
        {DEAL_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {DEAL_STAGE_LABELS[stage]}
          </option>
        ))}
      </select>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Amount</th>
              <th>Stage</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id}>
                <td>
                  <Link to={`/deals/${deal.id}`}>{deal.title}</Link>
                </td>
                <td>{deal.company?.name ?? "—"}</td>
                <td>
                  {deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "—"}
                </td>
                <td>{formatCurrency(deal.amount)}</td>
                <td>{DEAL_STAGE_LABELS[deal.stage]}</td>
                <td>{deal.owner?.name ?? "—"}</td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td colSpan={6}>No deals found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
