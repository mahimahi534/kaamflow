import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getQcQueue, getCategoryQcChecklist } from "@/lib/dal/quality-control";
import { QcInspectionDialog } from "@/components/quality-control/qc-inspection-dialog";

export default async function QualityControlPage() {
  const session = await requireRole(
    ["OWNER_ADMIN", "DISPATCHER", "QC_REVIEWER"],
    "/quality-control"
  );
  const businessId = session.profile.business_id;

  const { data: queue, error } = await getQcQueue(businessId);

  // Prepare checklists for items in queue
  const queueWithChecklists = await Promise.all(
    queue.map(async (item) => {
      const category = item.asset?.category || "Appliance";
      const checklist = await getCategoryQcChecklist(businessId, category);
      return {
        ...item,
        checklist,
      };
    })
  );

  const pendingReviewCount = queue.filter((i) => i.job.status === "qc_review").length;
  const passedCount = queue.filter((i) => i.latestQc?.passed === true).length;
  const failedReworkCount = queue.filter((i) => i.latestQc?.passed === false || i.reworkCount > 0).length;

  return (
    <AppShell
      title="Quality Control (QC)"
      subheading="Live bench inspection queue, checklist verification, rework management, and audit records."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Awaiting QC Inspection</p>
          <p className="mt-2 text-3xl font-semibold text-blue-600">{pendingReviewCount}</p>
          <p className="mt-1 text-xs text-blue-500">Submitted by bench technicians</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Passed Inspections</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">{passedCount}</p>
          <p className="mt-1 text-xs text-emerald-500">Authorized for handover</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Rework Cycles</p>
          <p className="mt-2 text-3xl font-semibold text-amber-600">{failedReworkCount}</p>
          <p className="mt-1 text-xs text-amber-500">Failed inspections returned to bench</p>
        </article>
      </section>

      {/* Main QC Inspection Queue */}
      <Panel
        title="Live QC Review Queue"
        action={
          <StatusBadge
            label={`${pendingReviewCount} Pending Review`}
            tone={pendingReviewCount > 0 ? "warning" : "success"}
          />
        }
      >
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <p className="font-semibold">Failed to load QC queue from database</p>
            <p className="mt-1">{error}</p>
          </div>
        ) : queueWithChecklists.length === 0 ? (
          <div className="py-8">
            <EmptyState
              title="QC queue is currently clear"
              description="When technicians complete bench repairs and submit jobs for inspection, they will automatically appear here."
            />
            <div className="mt-4 flex justify-center">
              <Link
                href="/jobs"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View Workshop Jobs Board
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="pb-3 pr-4">Job Reference</th>
                  <th className="pb-3 pr-4">Equipment & Issue</th>
                  <th className="pb-3 pr-4">Assigned Technician</th>
                  <th className="pb-3 pr-4">Current QC Status</th>
                  <th className="pb-3 pr-4">Reworks</th>
                  <th className="pb-3 text-right">Inspection Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queueWithChecklists.map((item) => {
                  const jobCode = `JOB-${item.job.id.slice(0, 8).toUpperCase()}`;
                  const equipmentName = item.asset
                    ? `${item.asset.category} - ${[item.asset.brand, item.asset.model].filter(Boolean).join(" ")}`
                    : "Unspecified Equipment";

                  return (
                    <tr key={item.job.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 pr-4">
                        <Link
                          href={`/jobs/${item.job.id}`}
                          className="font-bold text-blue-600 hover:underline"
                        >
                          {jobCode}
                        </Link>
                        {item.customer && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {item.customer.full_name}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 max-w-xs">
                        <p className="font-semibold text-slate-900 truncate">{equipmentName}</p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.job.issue_summary}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 text-slate-700">
                        {item.activeTechnician ? (
                          <span className="font-medium">{item.activeTechnician.full_name}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        {item.job.status === "qc_review" ? (
                          <StatusBadge label="Ready for QC Inspection" tone="warning" />
                        ) : item.latestQc?.passed ? (
                          <StatusBadge label="QC Passed" tone="success" />
                        ) : item.latestQc?.passed === false ? (
                          <StatusBadge label="QC Failed (In Rework)" tone="danger" />
                        ) : (
                          <StatusBadge label={item.job.status} tone="neutral" />
                        )}
                      </td>
                      <td className="py-3.5 pr-4">
                        {item.reworkCount > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            {item.reworkCount} cycle{item.reworkCount === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <QcInspectionDialog
                            jobId={item.job.id}
                            jobCode={jobCode}
                            equipmentName={equipmentName}
                            checklistItems={item.checklist}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Review Guidance & Compliance">
        <div className="space-y-2 text-xs leading-relaxed text-slate-600">
          <p>
            • <strong>Automatic Rework Routing:</strong> Submitting a failed inspection immediately transitions the repair job back to the active bench queue (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono">in_progress</code>), increments the rework counter, and stores your inspection notes for the technician.
          </p>
          <p>
            • <strong>Handover Authorization:</strong> A job cannot be marked completed or released for customer handover until a passing QC inspection is recorded, or an authorized Owner/Admin exception is logged with a mandatory audit reason.
          </p>
        </div>
      </Panel>
    </AppShell>
  );
}
