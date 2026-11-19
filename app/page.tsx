import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getAnalyticsSummary } from "@/lib/dal/analytics";
import { getJobs } from "@/lib/dal/jobs";

const STATUS_LABELS: Record<string, string> = {
  new_request: "New request",
  intake: "Intake",
  diagnosis: "Diagnosis",
  quotation: "Quotation",
  awaiting_customer_approval: "Awaiting approval",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting_for_parts: "Waiting for parts",
  qc_review: "QC review",
  completed: "Completed",
  handover: "Handover",
  closed: "Closed",
};

function statusTone(status: string) {
  if (status === "awaiting_customer_approval" || status === "waiting_for_parts") return "warning";
  if (status === "qc_review") return "primary";
  if (["completed", "handover", "closed"].includes(status)) return "success";
  return "neutral";
}

export default async function HomePage() {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER", "QC_REVIEWER"], "/");
  const businessId = session.profile.business_id;

  if (!businessId) {
    return (
      <AppShell title="Dashboard" subheading="Your workshop overview.">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your staff profile is not linked to a workshop. Ask an administrator to finish account setup.
        </div>
      </AppShell>
    );
  }

  const [analytics, jobsResult] = await Promise.all([
    getAnalyticsSummary(),
    getJobs(businessId, { status: "active", limit: 8 }),
  ]);
  const metrics = [
    { label: "Active jobs", value: analytics.activeJobs.toLocaleString(), tone: "primary" as const },
    { label: "Awaiting quality control", value: analytics.awaitingQc.toLocaleString(), tone: "warning" as const },
    { label: "Waiting for parts", value: analytics.waitingParts.toLocaleString(), tone: "neutral" as const },
    { label: "Follow-ups due", value: analytics.followUpsDue.toLocaleString(), tone: "warning" as const },
  ];

  return (
    <AppShell
      title="Workshop dashboard"
      subheading="A live overview of repair activity and customer outcomes."
    >
      {analytics.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Dashboard metrics could not be loaded.</p>
          <p className="mt-1">{analytics.error}</p>
        </div>
      )}

      {!analytics.error && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              tone={metric.tone}
              detail="Live records for your workshop"
            />
          ))}
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.6fr_0.9fr]">
        <Panel
          title="Active repair queue"
          action={<Link href="/jobs" className="text-sm font-medium text-blue-600">View all jobs</Link>}
        >
          {jobsResult.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Could not load repair jobs.</p>
              <p className="mt-1">{jobsResult.error}</p>
            </div>
          ) : jobsResult.data.length === 0 ? (
            <EmptyState
              title="No active repair jobs"
              description="New jobs will appear here when they are created for your workshop."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-3 pr-4 font-medium">Job</th>
                    <th className="pb-3 pr-4 font-medium">Customer</th>
                    <th className="pb-3 pr-4 font-medium">Equipment</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Technician</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsResult.data.map((job) => (
                    <tr key={job.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-3 pr-4">
                        <Link href={`/jobs/${job.id}`} className="font-semibold text-blue-700 hover:underline">
                          JOB-{job.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{job.customer?.full_name || "Guest customer"}</td>
                      <td className="py-3 pr-4 text-slate-700">
                        {job.asset
                          ? `${job.asset.category} ${[job.asset.brand, job.asset.model].filter(Boolean).join(" ")}`
                          : job.issue_summary}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={STATUS_LABELS[job.status] || job.status} tone={statusTone(job.status)} />
                      </td>
                      <td className="py-3 text-slate-700">{job.active_assignment?.technician?.full_name || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Workshop snapshot">
          {analytics.error ? (
            <p className="text-sm text-slate-500">Snapshot figures are unavailable until the data connection is healthy.</p>
          ) : (
            <div className="space-y-3">
              {[
                ["Customers", analytics.totalCustomers, "/customers"],
                ["Open service requests", analytics.totalRequests, "/requests"],
                ["Comeback cases", analytics.totalComebacks, "/fixloop"],
                ["Completed repairs", analytics.completedJobs, "/jobs?status=completed"],
              ].map(([label, count, href]) => (
                <Link
                  key={label}
                  href={href as string}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-blue-200 hover:bg-blue-50/50"
                >
                  <span className="text-sm text-slate-600">{label}</span>
                  <span className="text-lg font-semibold text-slate-900">{count}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel
        title="FixLoop outcome insights"
        action={<Link href="/analytics" className="text-sm font-medium text-blue-600">View analytics</Link>}
      >
        {analytics.error ? (
          <p className="text-sm text-slate-500">Outcome figures are unavailable because the database query failed.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {analytics.outcomeMetrics.slice(0, 3).map((metric) => (
              <article key={metric.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{metric.value}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {metric.numerator} of {metric.denominator} reported outcomes
                  {metric.isReliable ? "" : " · small sample"}
                </p>
              </article>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          Unanswered follow-ups remain unknown and are never counted as successful repairs.
        </div>
      </Panel>
    </AppShell>
  );
}
