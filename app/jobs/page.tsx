import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getJobs, getJobCounts } from "@/lib/dal/jobs";
import { JobSearchFilter } from "@/components/jobs/job-search-filter";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { JobStatus } from "@/lib/types/database";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const session = await requireRole(
    ["OWNER_ADMIN", "DISPATCHER", "TECHNICIAN", "QC_REVIEWER"],
    "/jobs"
  );
  const businessId = session.profile.business_id;

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search || "";
  const statusParam = (resolvedSearchParams.status || "active") as JobStatus | "all" | "active";

  const [{ data: jobList, totalCount, error }, counts] = await Promise.all([
    getJobs(businessId, { search, status: statusParam }),
    getJobCounts(businessId),
  ]);

  return (
    <AppShell
      title="Repair Jobs"
      subheading="Manage active repair pipeline, diagnoses, technician assignments, and parts tracking."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Active Repair Jobs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{counts.active}</p>
          <p className="mt-1 text-xs text-slate-500">Currently in workshop</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">In Progress</p>
          <p className="mt-2 text-3xl font-semibold text-blue-600">{counts.inProgress}</p>
          <p className="mt-1 text-xs text-blue-500">Active bench repairs</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Waiting for Parts</p>
          <p className="mt-2 text-3xl font-semibold text-amber-600">{counts.waitingParts}</p>
          <p className="mt-1 text-xs text-amber-500">Procurement pending</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Awaiting QC Review</p>
          <p className="mt-2 text-3xl font-semibold text-purple-600">{counts.qcReview}</p>
          <p className="mt-1 text-xs text-purple-500">Ready for inspection</p>
        </article>
      </section>

      {/* Main Jobs Board */}
      <Panel
        title="Repair Queue"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label={`${totalCount} Total`} tone="primary" />
            {(session.profile.role === "OWNER_ADMIN" || session.profile.role === "DISPATCHER") && (
              <Link href="/jobs/new">
                <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                  <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  New Repair Job
                </Button>
              </Link>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <JobSearchFilter />

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Failed to load repair jobs</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : jobList.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title={
                  search || statusParam !== "active"
                    ? "No matching repair jobs"
                    : "No active repair jobs in queue"
                }
                description={
                  search || statusParam !== "active"
                    ? "Try adjusting your search terms or status filter."
                    : "All clear! Create a new repair job or convert a pending service request."
                }
              />
              {!search && statusParam === "active" && (
                <div className="mt-4 flex justify-center gap-3">
                  <Link href="/jobs/new">
                    <Button>Create Repair Job</Button>
                  </Link>
                  <Link href="/requests">
                    <Button variant="secondary">View Intake Requests</Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-3.5">Job ID</th>
                    <th scope="col" className="px-4 py-3.5">Customer & Device</th>
                    <th scope="col" className="px-4 py-3.5">Issue Summary</th>
                    <th scope="col" className="px-4 py-3.5">Assigned Crew</th>
                    <th scope="col" className="px-4 py-3.5">Status</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jobList.map((job) => (
                    <tr key={job.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3.5 font-mono text-xs font-bold text-blue-600">
                        <Link href={`/jobs/${job.id}`} className="hover:underline">
                          JOB-{job.id.slice(0, 8).toUpperCase()}
                        </Link>
                        {job.service_request && (
                          <p className="text-[11px] text-slate-400 font-normal">
                            Ref: {job.service_request.request_reference}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {job.customer ? (
                          <Link
                            href={`/customers/${job.customer.id}`}
                            className="font-semibold text-slate-900 hover:text-blue-600 hover:underline"
                          >
                            {job.customer.full_name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-900">Unassigned Customer</span>
                        )}
                        {job.asset ? (
                          <p className="text-xs text-slate-500">
                            {job.asset.category}: {job.asset.brand} {job.asset.model}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No asset linked</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 max-w-sm truncate">
                        {job.issue_summary}
                      </td>
                      <td className="px-4 py-3.5">
                        {job.active_assignment?.technician ? (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-medium text-slate-800">
                              {job.active_assignment.technician.full_name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          View Job &rarr;
                        </Link>
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
