import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getServiceRequests, getServiceRequestCount } from "@/lib/dal/service-requests";
import { RequestSearchFilter } from "@/components/requests/request-search-filter";
import type { UrgencyLevel } from "@/lib/types/database";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; urgency?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/requests");
  const businessId = session.profile.business_id;

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search || "";
  const urgency = (resolvedSearchParams.urgency || "all") as UrgencyLevel | "all";

  const [
    { data: requestList, totalCount, error },
    totalCountAll,
    urgentCount,
    highCount,
  ] = await Promise.all([
    getServiceRequests(businessId, { search, urgency }),
    getServiceRequestCount(businessId),
    getServiceRequestCount(businessId, "urgent"),
    getServiceRequestCount(businessId, "high"),
  ]);

  return (
    <AppShell
      title="Service Requests"
      subheading="Manage customer service intake, triage urgency queues, and schedule diagnostic evaluations."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Total Requests</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCountAll}</p>
          <p className="mt-1 text-xs text-slate-500">Intake log total</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Matching Query</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCount}</p>
          <p className="mt-1 text-xs text-slate-500">
            {search || urgency !== "all" ? "Filtered view" : "All records"}
          </p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Urgent (Immediate)</p>
          <p className="mt-2 text-3xl font-semibold text-rose-600">{urgentCount}</p>
          <p className="mt-1 text-xs text-rose-500">Critical attention</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">High Priority</p>
          <p className="mt-2 text-3xl font-semibold text-amber-600">{highCount}</p>
          <p className="mt-1 text-xs text-amber-500">24-hr target turnaround</p>
        </article>
      </section>

      {/* Main Table Panel */}
      <Panel
        title="Intake & Service Queue"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label={`${totalCount} Total`} tone="primary" />
            <Link href="/requests/new">
              <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                New Service Request
              </Button>
            </Link>
          </div>
        }
      >
        <div className="space-y-4">
          <RequestSearchFilter />

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Failed to load service requests</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : requestList.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title={
                  search || urgency !== "all"
                    ? "No matching service requests"
                    : "No service requests yet"
                }
                description={
                  search || urgency !== "all"
                    ? "Try adjusting your search terms or urgency level filter."
                    : "Create your first customer service request to begin intake and repairs."
                }
              />
              {!search && urgency === "all" && (
                <div className="mt-4 flex justify-center">
                  <Link href="/requests/new">
                    <Button>Create First Request</Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-3.5">Reference</th>
                    <th scope="col" className="px-4 py-3.5">Customer</th>
                    <th scope="col" className="px-4 py-3.5">Equipment</th>
                    <th scope="col" className="px-4 py-3.5">Reported Problem</th>
                    <th scope="col" className="px-4 py-3.5">Urgency</th>
                    <th scope="col" className="px-4 py-3.5">Submitted</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requestList.map((req) => (
                    <tr key={req.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3.5 font-mono font-semibold text-blue-600">
                        <Link href={`/requests/${req.id}`} className="hover:underline">
                          {req.request_reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        {req.customer ? (
                          <Link
                            href={`/customers/${req.customer.id}`}
                            className="font-medium text-slate-900 hover:text-blue-600 hover:underline"
                          >
                            {req.customer_name}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">{req.customer_name}</span>
                        )}
                        <p className="text-xs text-slate-500">{req.phone}</p>
                      </td>
                      <td className="px-4 py-3.5 text-slate-800">
                        <p className="font-medium text-slate-900">{req.equipment_category}</p>
                        <p className="text-xs text-slate-500">{req.brand_model}</p>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 max-w-xs truncate">
                        {req.reported_problem}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge
                          label={req.urgency.toUpperCase()}
                          tone={
                            req.urgency === "urgent"
                              ? "danger"
                              : req.urgency === "high"
                                ? "warning"
                                : req.urgency === "medium"
                                  ? "primary"
                                  : "neutral"
                          }
                        />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {new Date(req.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/requests/${req.id}`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            View
                          </Link>
                          <Link
                            href={`/requests/${req.id}/edit`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
