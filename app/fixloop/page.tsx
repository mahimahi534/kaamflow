import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getFixLoopQueue, getComebackCases } from "@/lib/dal/fixloop";
import { RecordOutcomeDialog } from "@/components/fixloop/record-outcome-dialog";

export default async function FixLoopPage() {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/fixloop");
  const businessId = session.profile.business_id;

  const [{ data: followUpQueue, error: fuErr }, { data: comebackList }] = await Promise.all([
    getFixLoopQueue(businessId),
    getComebackCases(businessId),
  ]);

  const scheduledCount = followUpQueue.filter((i) => i.followUp.status === "scheduled" || i.followUp.status === "sent").length;
  const completedCount = followUpQueue.filter((i) => i.followUp.status === "completed").length;
  const comebackCount = comebackList.length;

  return (
    <AppShell
      title="FixLoop Outcomes"
      subheading="Post-handover customer verification, follow-up queues, comeback case tracking, and outcome intelligence."
    >
      {/* 5 Core Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Working as expected", "Confirmed positive outcome", "bg-emerald-50 text-emerald-800 border-emerald-200"],
          ["Same symptom returned", "Enters Comeback Case", "bg-rose-50 text-rose-800 border-rose-200"],
          ["Partly improved", "Under human review", "bg-amber-50 text-amber-800 border-amber-200"],
          ["Different issue", "New linked service request", "bg-blue-50 text-blue-800 border-blue-200"],
          ["No response", "Outcome remains unknown", "bg-slate-50 text-slate-700 border-slate-200"],
        ].map(([response, meaning, style]) => (
          <article key={response} className={`rounded-2xl border p-4 shadow-sm ${style}`}>
            <p className="font-bold text-xs uppercase tracking-wider">{response}</p>
            <p className="mt-2 text-xs opacity-85 leading-snug">{meaning}</p>
          </article>
        ))}
      </div>

      {/* Main Live Follow-up Queue */}
      <Panel
        title="Live Follow-Up Queue"
        action={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={`${scheduledCount} Pending`}
              tone={scheduledCount > 0 ? "warning" : "neutral"}
            />
            <StatusBadge
              label={`${completedCount} Completed`}
              tone="success"
            />
            <StatusBadge
              label={`${comebackCount} Comebacks`}
              tone={comebackCount > 0 ? "danger" : "neutral"}
            />
          </div>
        }
      >
        {fuErr ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <p className="font-semibold">Failed to load follow-up queue from database</p>
            <p className="mt-1">{fuErr}</p>
          </div>
        ) : followUpQueue.length === 0 ? (
          <div className="py-8">
            <EmptyState
              title="No active follow-ups in queue"
              description="When repairs are completed and handed over to customers, 3-day post-service follow-ups automatically queue here for verification."
            />
            <div className="mt-4 flex justify-center">
              <Link
                href="/jobs"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View Repair Jobs
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="pb-3 pr-4">Original Job</th>
                  <th className="pb-3 pr-4">Customer & Contact</th>
                  <th className="pb-3 pr-4">Equipment Repaired</th>
                  <th className="pb-3 pr-4">Follow-Up Due</th>
                  <th className="pb-3 pr-4">Status / Outcome</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {followUpQueue.map((item) => {
                  const jobCode = `JOB-${item.job.id.slice(0, 8).toUpperCase()}`;
                  const equipmentName = item.asset
                    ? `${item.asset.category} - ${[item.asset.brand, item.asset.model].filter(Boolean).join(" ")}`
                    : "Unspecified Equipment";
                  const dueDate = new Date(item.followUp.due_at).toLocaleDateString();

                  return (
                    <tr key={item.followUp.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 pr-4">
                        <Link
                          href={`/jobs/${item.job.id}`}
                          className="font-bold text-blue-600 hover:underline"
                        >
                          {jobCode}
                        </Link>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.job.issue_summary}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <p className="font-semibold text-slate-900">
                          {item.customer?.full_name || "Guest Customer"}
                        </p>
                        {item.customer?.phone && (
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {item.customer.phone}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 text-slate-700">
                        <p className="font-medium">{equipmentName}</p>
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="font-medium text-slate-700">{dueDate}</span>
                      </td>
                      <td className="py-3.5 pr-4">
                        {item.outcome ? (
                          <StatusBadge
                            label={
                              item.outcome.outcome === "working_as_expected"
                                ? "Working as expected"
                                : item.outcome.outcome === "same_symptom"
                                  ? "Same symptom (Comeback)"
                                  : item.outcome.outcome === "different_issue"
                                    ? "Different issue (New Req)"
                                    : item.outcome.outcome === "partly_improved"
                                      ? "Partly improved"
                                      : "No response"
                            }
                            tone={
                              item.outcome.outcome === "working_as_expected"
                                ? "success"
                                : item.outcome.outcome === "same_symptom"
                                  ? "danger"
                                  : item.outcome.outcome === "partly_improved"
                                    ? "warning"
                                    : "neutral"
                            }
                          />
                        ) : (
                          <StatusBadge
                            label={
                              item.followUp.status === "scheduled"
                                ? "Scheduled"
                                : item.followUp.status === "sent"
                                  ? "Outreach Sent"
                                  : item.followUp.status
                            }
                            tone={item.followUp.status === "scheduled" ? "primary" : "neutral"}
                          />
                        )}
                      </td>
                      <td className="py-3.5 text-right">
                        {item.followUp.status !== "completed" ? (
                          <RecordOutcomeDialog
                            followUpId={item.followUp.id}
                            jobCode={jobCode}
                            customerName={item.customer?.full_name || "Customer"}
                            customerPhone={item.customer?.phone}
                            equipmentName={equipmentName}
                          />
                        ) : (
                          <span className="text-[11px] font-semibold text-emerald-600">
                            Recorded ✓
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Comeback Cases Section */}
      <Panel
        title={`Linked Comeback Cases (${comebackList.length})`}
        action={<StatusBadge label="Same Symptom Returns" tone="danger" />}
      >
        {comebackList.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">
            No comeback cases recorded. All confirmed follow-up repairs are holding without recurrence.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="pb-2 pr-4">Case ID</th>
                  <th className="pb-2 pr-4">Original Job</th>
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Reported Issue Summary</th>
                  <th className="pb-2 pr-4">Case Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comebackList.map((cb) => (
                  <tr key={cb.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 pr-4 font-mono font-bold text-slate-900">
                      CB-{cb.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="py-3 pr-4 font-semibold text-blue-600">
                      <Link href={`/jobs/${cb.original_job_id}`} className="hover:underline">
                        JOB-{cb.original_job_id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-800">
                      {cb.customer?.full_name || "Customer"}
                    </td>
                    <td className="py-3 pr-4 text-slate-700 max-w-sm truncate">
                      {cb.issue_summary}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge label={cb.status} tone="warning" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 leading-relaxed">
        <strong>FixLoop Intelligence Rule:</strong> Unanswered customer follow-ups (<code className="font-mono bg-white px-1 py-0.5 rounded">no_response</code>) represent unknown states and are strictly excluded from positive repair calculations. They never count as successful fixes.
      </div>
    </AppShell>
  );
}
