import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/server";
import { getTechnicians } from "@/lib/dal/technicians";

export default async function TechniciansPage() {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/technicians");
  const businessId = session.profile.business_id;

  const { data: technicianList, error } = await getTechnicians(businessId);

  const totalActiveJobs = technicianList.reduce((sum, t) => sum + t.active_job_count, 0);

  return (
    <AppShell
      title="Technicians"
      subheading="Manage workshop repair team, bench capacity, and active job dispatch workloads."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Total Staff Technicians</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{technicianList.length}</p>
          <p className="mt-1 text-xs text-slate-500">Active profiles in business</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Active Dispatches</p>
          <p className="mt-2 text-3xl font-semibold text-blue-600">{totalActiveJobs}</p>
          <p className="mt-1 text-xs text-blue-500">Jobs currently assigned</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Available Technicians</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">
            {technicianList.filter((t) => t.active_job_count === 0).length}
          </p>
          <p className="mt-1 text-xs text-emerald-500">Ready for dispatch</p>
        </article>
      </section>

      {/* Technicians Directory Table */}
      <Panel
        title="Team Directory"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label={`${technicianList.length} Team Members`} tone="primary" />
            <Link href="/technician">
              <Button variant="secondary" className="text-xs sm:text-sm py-1.5 px-3">
                Open Technician Workspace &rarr;
              </Button>
            </Link>
          </div>
        }
      >
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Failed to load technicians</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50/80">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3.5">Technician</th>
                  <th scope="col" className="px-4 py-3.5">Email</th>
                  <th scope="col" className="px-4 py-3.5">Role</th>
                  <th scope="col" className="px-4 py-3.5">Active Jobs</th>
                  <th scope="col" className="px-4 py-3.5">Completed Repairs</th>
                  <th scope="col" className="px-4 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {technicianList.map((tech) => (
                  <tr key={tech.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3.5 font-bold text-slate-900">
                      {tech.full_name}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-xs">
                      {tech.email}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge label={tech.role} tone="neutral" />
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-900">
                      {tech.active_job_count > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {tech.active_job_count} active
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-700">
                      {tech.completed_job_count}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        label={tech.active_job_count === 0 ? "Available" : "On Repairs"}
                        tone={tech.active_job_count === 0 ? "success" : "warning"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
