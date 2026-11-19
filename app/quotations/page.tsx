import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getQuotations, getQuotationCounts } from "@/lib/dal/quotations";
import { QuotationStatusBadge } from "@/components/quotations/quotation-status-badge";
import { QuotationSearchFilter } from "@/components/quotations/quotation-search-filter";
import type { QuoteStatus } from "@/lib/types/database";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/quotations");
  const businessId = session.profile.business_id;

  const resolvedParams = await searchParams;
  const search = resolvedParams.search || "";
  const statusParam = (resolvedParams.status || "all") as QuoteStatus | "all";
  const dateFrom = resolvedParams.dateFrom || "";
  const dateTo = resolvedParams.dateTo || "";

  const [{ data: quoteList, totalCount, error }, counts] = await Promise.all([
    getQuotations(businessId, {
      search,
      status: statusParam,
      dateFrom,
      dateTo,
    }),
    getQuotationCounts(businessId),
  ]);

  return (
    <AppShell
      title="Quotations"
      subheading="Manage pricing estimates, versioned scope snapshots, and customer approvals."
    >
      {/* Top action header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <span className="text-xs text-slate-500">
            {totalCount} quotation record{totalCount === 1 ? "" : "s"} found across workshop
          </span>
        </div>
        <Link href="/quotations/new">
          <Button>Create Quotation</Button>
        </Link>
      </div>

      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Total Quotations
          </span>
          <div className="mt-2 text-2xl font-bold text-slate-900">{counts.total}</div>
          <span className="mt-1 text-xs text-slate-500">All registered versions</span>
        </article>

        <article className="metric-card">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Draft Quotes
          </span>
          <div className="mt-2 text-2xl font-bold text-slate-700">{counts.draft}</div>
          <span className="mt-1 text-xs text-slate-500">Unsent estimates</span>
        </article>

        <article className="metric-card">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Awaiting Approval
          </span>
          <div className="mt-2 text-2xl font-bold text-blue-600">{counts.sent}</div>
          <span className="mt-1 text-xs text-blue-600 font-medium">Delivered to customer</span>
        </article>

        <article className="metric-card">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Approved Quotes
          </span>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{counts.approved}</div>
          <span className="mt-1 text-xs text-emerald-600 font-medium">Ready for repair bench</span>
        </article>
      </section>

      {/* Filter and Search Bar */}
      <QuotationSearchFilter />

      {/* Quotation Table */}
      <Panel title="Quotation Versions">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : quoteList.length === 0 ? (
          <div className="space-y-4">
            <EmptyState
              title="No quotations found"
              description={
                search || statusParam !== "all" || dateFrom || dateTo
                  ? "Try adjusting your search criteria or filter options."
                  : "Create your first quotation from an active repair job to send estimates to customers."
              }
            />
            <div className="text-center">
              <Link href="/quotations/new">
                <Button>Create Quotation</Button>
              </Link>
            </div>
          </div>
        ) : (
          <DataTable
            rows={quoteList}
            getRowKey={(q) => q.id}
            columns={[
              {
                key: "reference",
                header: "Quotation Ref",
                cell: (q) => (
                  <div>
                    <Link
                      href={`/quotations/${q.id}`}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      QT-{q.id.slice(0, 8).toUpperCase()}
                    </Link>
                    <div className="text-xs text-slate-500">v{q.version_number} snapshot</div>
                  </div>
                ),
              },
              {
                key: "job",
                header: "Related Job",
                cell: (q) => (
                  <div>
                    <Link
                      href={`/jobs/${q.job_id}`}
                      className="text-xs font-medium text-slate-800 hover:text-blue-600 hover:underline"
                    >
                      Job #{q.job_id.slice(0, 8)}
                    </Link>
                    <div className="text-xs text-slate-500 line-clamp-1 max-w-[200px]">
                      {q.job?.issue_summary || "No summary"}
                    </div>
                  </div>
                ),
              },
              {
                key: "customer",
                header: "Customer",
                cell: (q) => (
                  <div>
                    <span className="font-medium text-slate-900">
                      {q.customer?.full_name || "Unassigned"}
                    </span>
                    {q.customer?.phone && (
                      <div className="text-xs text-slate-500">{q.customer.phone}</div>
                    )}
                  </div>
                ),
              },
              {
                key: "equipment",
                header: "Equipment",
                cell: (q) => (
                  <span className="text-xs text-slate-700">
                    {q.asset
                      ? `${q.asset.brand || ""} ${q.asset.model || ""}`.trim() || q.asset.category
                      : "—"}
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Total (Inc. Tax)",
                cell: (q) => (
                  <div>
                    <span className="font-semibold text-slate-900">
                      ${Number(q.total_amount || 0).toFixed(2)}
                    </span>
                    <div className="text-[11px] text-slate-400">
                      L: ${Number(q.labour_charge || 0).toFixed(2)} | P: ${Number(q.parts_cost || 0).toFixed(2)}
                    </div>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (q) => <QuotationStatusBadge status={q.status} size="sm" />,
              },
              {
                key: "created_at",
                header: "Created Date",
                cell: (q) => (
                  <span className="text-xs text-slate-500">
                    {new Date(q.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                ),
              },
              {
                key: "actions",
                header: "",
                cell: (q) => (
                  <Link
                    href={`/quotations/${q.id}`}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    View &rarr;
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
