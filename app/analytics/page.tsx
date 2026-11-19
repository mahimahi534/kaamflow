import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/server";
import { getAnalyticsSummary } from "@/lib/dal/analytics";

const STATUS_LABELS: Record<string, string> = {
  new_request: "New Request",
  intake: "Intake",
  diagnosis: "Diagnosis",
  quotation: "Quotation",
  awaiting_customer_approval: "Awaiting Approval",
  assigned: "Assigned",
  in_progress: "In Progress",
  waiting_for_parts: "Waiting for Parts",
  qc_review: "QC Review",
  completed: "Completed",
  handover: "Handover",
  closed: "Closed",
};

export default async function AnalyticsPage() {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/analytics");

  const analytics = await getAnalyticsSummary();

  const dashboardCards = [
    { label: "Total Customers", value: analytics.totalCustomers.toLocaleString(), tone: "primary" as const },
    { label: "Service Requests", value: analytics.totalRequests.toLocaleString(), tone: "neutral" as const },
    { label: "Active Repair Jobs", value: analytics.activeJobs.toLocaleString(), tone: "warning" as const },
    { label: "Completed Jobs", value: analytics.completedJobs.toLocaleString(), tone: "success" as const },
    { label: "Awaiting QC", value: analytics.awaitingQc.toLocaleString(), tone: "primary" as const },
    { label: "Waiting for Parts", value: analytics.waitingParts.toLocaleString(), tone: "neutral" as const },
    { label: "Follow-ups Due", value: analytics.followUpsDue.toLocaleString(), tone: "danger" as const },
    { label: "Total Jobs (All Time)", value: analytics.totalJobs.toLocaleString(), tone: "neutral" as const },
  ];

  return (
    <AppShell
      title="Analytics"
      subheading="Live business metrics, outcome tracking, and operational health dashboard."
    >
      {/* Top-level KPI Cards */}
      {analytics.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Analytics data could not be loaded.</p>
          <p className="mt-1">{analytics.error}</p>
        </div>
      ) : <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {dashboardCards.map((card) => (
          <article key={card.label} className="metric-card">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{card.value}</p>
            <div className="mt-1">
              <StatusBadge label="Live Data" tone={card.tone} />
            </div>
          </article>
        ))}
      </div>}

      {/* Outcome Metrics with Numerator/Denominator/Sample Size */}
      <Panel
        title="Outcome Metrics"
        action={<StatusBadge label="NO_RESPONSE excluded from success" tone="warning" />}
      >
        {analytics.error ? (
          <p className="text-sm text-rose-700">Outcome metrics are unavailable until the database query succeeds.</p>
        ) : analytics.outcomeMetrics.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">No follow-up outcomes recorded yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Outcome metrics will appear after FixLoop follow-ups are completed and customer outcomes recorded.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Metric</th>
                  <th className="pb-3 pr-4 font-medium">Numerator</th>
                  <th className="pb-3 pr-4 font-medium">Denominator</th>
                  <th className="pb-3 pr-4 font-medium">Rate</th>
                  <th className="pb-3 pr-4 font-medium">Sample Size</th>
                  <th className="pb-3 pr-4 font-medium">Reliability</th>
                </tr>
              </thead>
              <tbody>
                {analytics.outcomeMetrics.map((m) => (
                  <tr key={m.label} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-3 pr-4 font-semibold text-slate-900">{m.label}</td>
                    <td className="py-3 pr-4 text-slate-700 font-mono">{m.numerator}</td>
                    <td className="py-3 pr-4 text-slate-700 font-mono">{m.denominator}</td>
                    <td className="py-3 pr-4 font-bold text-slate-900">{m.value}</td>
                    <td className="py-3 pr-4 text-slate-700 font-mono">{m.sampleSize}</td>
                    <td className="py-3 pr-4">
                      {m.isReliable ? (
                        <StatusBadge label="Reliable" tone="success" />
                      ) : (
                        <StatusBadge label="Small Sample" tone="warning" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Job Status Distribution */}
      <Panel title="Job Status Distribution">
        {analytics.error ? (
          <p className="text-sm text-rose-700">Job status data is unavailable until the database query succeeds.</p>
        ) : analytics.statusBreakdown.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No jobs found in the system.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analytics.statusBreakdown
              .sort((a, b) => b.count - a.count)
              .map((item) => (
                <div
                  key={item.status}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3"
                >
                  <span className="text-sm font-medium text-slate-700">
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                  <span className="text-lg font-bold text-slate-900">{item.count}</span>
                </div>
              ))}
          </div>
        )}
      </Panel>

      {/* Interpretation Notes */}
      <Panel title="Interpretation Guide" action={<StatusBadge label="Methodology" tone="primary" />}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <strong>Confirmed outcome rate</strong> is calculated using valid customer responses only.
            Unanswered follow-ups (NO_RESPONSE) are excluded from the positive outcome numerator and denominator.
          </p>
          <p>
            <strong>Same-symptom comeback rate</strong> evaluates completed jobs that have passed the configured observation window
            and received a follow-up outcome of SAME_SYMPTOM.
          </p>
          <p>
            <strong>Unknown outcome rate</strong> measures follow-ups with no usable response within the selected time window.
          </p>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <strong>⚠ Small Sample Warning:</strong> Metrics marked &quot;Small Sample&quot; have fewer than 20 eligible cases.
            These rates may not represent reliable patterns and should not be used for performance decisions
            until more data is collected.
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}
