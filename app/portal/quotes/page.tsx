import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth/server";
import { getMyCustomerQuotations } from "@/lib/dal/quotations";

export default async function CustomerQuotesPage() {
  const session = await requireAuth("/portal/quotes");

  const { data: myQuotes, error } = await getMyCustomerQuotations();

  return (
    <AppShell
      title="My Repair Quotations"
      subheading={`Welcome, ${session.profile.full_name}. Review and authorize repair estimates.`}
    >
      <Panel title="Active Estimates for Approval">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            {error}
          </div>
        ) : myQuotes.length === 0 ? (
          <EmptyState
            title="No active quotations"
            description="You do not have any pending quotations awaiting your approval at this time."
          />
        ) : (
          <DataTable
            rows={myQuotes}
            getRowKey={(q) => q.quote_version_id}
            columns={[
              {
                key: "reference",
                header: "Quotation Ref",
                cell: (q) => (
                  <Link
                    href={`/portal/quotes/${q.quote_version_id}`}
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    QT-{q.quote_version_id.slice(0, 8).toUpperCase()} (v{q.version_number})
                  </Link>
                ),
              },
              {
                key: "job",
                header: "Repair Job",
                cell: (q) => (
                  <span className="text-xs text-slate-700">
                    Job #{q.job_id.slice(0, 8)}
                  </span>
                ),
              },
              {
                key: "labour",
                header: "Labor",
                cell: (q) => `$${q.labour_charge.toFixed(2)}`,
              },
              {
                key: "parts",
                header: "Parts",
                cell: (q) => `$${q.parts_cost.toFixed(2)}`,
              },
              {
                key: "total",
                header: "Total (Inc. Tax)",
                cell: (q) => (
                  <span className="font-bold text-slate-900">
                    ${q.total_amount.toFixed(2)}
                  </span>
                ),
              },
              {
                key: "actions",
                header: "",
                cell: (q) => (
                  <Link
                    href={`/portal/quotes/${q.quote_version_id}`}
                    className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Review & Authorize &rarr;
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Panel>
    </AppShell>
  );
}
