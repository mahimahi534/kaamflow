import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getTechnicianJobs } from "@/lib/dal/technicians";
import { getJobs } from "@/lib/dal/jobs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { JobStatusUpdater } from "@/components/jobs/job-status-updater";

export default async function TechnicianPage() {
  const session = await requireRole(["OWNER_ADMIN", "TECHNICIAN"], "/technician");
  const businessId = session.profile.business_id;
  const isOwner = session.profile.role === "OWNER_ADMIN";

  // For technicians, get their assigned jobs; for owner admin, get assigned jobs or active workshop jobs
  let jobs = (await getTechnicianJobs(session.user.id, businessId)).data;

  if (jobs.length === 0 && isOwner) {
    // Show active workshop jobs for the owner so they can test and operate
    const allActive = await getJobs(businessId, { status: "active" });
    jobs = allActive.data;
  }

  return (
    <AppShell
      title="Technician Workspace"
      subheading="Bench execution board, assigned active repairs, diagnostic logging, and checklists."
    >
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        {/* Assigned Jobs List */}
        <Panel
          title={`Assigned Repair Jobs (${jobs.length})`}
          action={<StatusBadge label="Bench Ready" tone="success" />}
        >
          {jobs.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title="No repair jobs currently assigned"
                description="When jobs are dispatched to your bench, they will appear here with diagnostic checklists."
              />
              <div className="mt-4 flex justify-center">
                <Link
                  href="/jobs"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View All Workshop Jobs
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 hover:border-slate-300 transition"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-blue-600">
                        JOB-{job.id.slice(0, 8).toUpperCase()}
                      </span>
                      {job.service_request && (
                        <span className="ml-2 text-xs text-slate-400">
                          (Ref: {job.service_request.request_reference})
                        </span>
                      )}
                      <p className="mt-1 font-bold text-slate-900 text-base">
                        {job.customer ? job.customer.full_name : "Unassigned Customer"}
                      </p>
                    </div>
                    <JobStatusBadge status={job.status} />
                  </div>

                  {job.asset && (
                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                      <strong>Device:</strong> {job.asset.category} &bull; {job.asset.brand} {job.asset.model}
                      {job.asset.serial_number && (
                        <span className="ml-2 font-mono text-slate-500">[{job.asset.serial_number}]</span>
                      )}
                    </div>
                  )}

                  <p className="text-sm text-slate-800 font-medium">{job.issue_summary}</p>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">Update Status:</span>
                      <JobStatusUpdater
                        jobId={job.id}
                        currentStatus={job.status}
                        userRole={session.profile.role}
                      />
                    </div>

                    <Link
                      href={`/jobs/${job.id}`}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                    >
                      Open Repair Bench &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Quick Bench Checklist */}
        <div className="space-y-6">
          <Panel title="Technician Workflow Checklist" action={<StatusBadge label="Bench Protocol" tone="neutral" />}>
            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition shadow-sm">
                <input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <span className="font-semibold text-slate-900">1. Initial Fault Isolation</span>
                  <p className="text-xs text-slate-500 mt-0.5">Bench meter test and symptom verification against intake notes.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition shadow-sm">
                <input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <span className="font-semibold text-slate-900">2. Record Technical Diagnosis</span>
                  <p className="text-xs text-slate-500 mt-0.5">Isolate root cause and log diagnostic findings in ticket.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition shadow-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <span className="font-semibold text-slate-900">3. Log Parts & Materials</span>
                  <p className="text-xs text-slate-500 mt-0.5">Record consumed parts, quantities, and cost for billing.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition shadow-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <span className="font-semibold text-slate-900">4. Bench Testing & Burn-In</span>
                  <p className="text-xs text-slate-500 mt-0.5">Verify repair operates within manufacturer specifications.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition shadow-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <span className="font-semibold text-slate-900">5. Submit for QC Review</span>
                  <p className="text-xs text-slate-500 mt-0.5">Transition status to QC Review for secondary inspector pass.</p>
                </div>
              </label>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
