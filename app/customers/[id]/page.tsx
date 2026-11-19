import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getCustomerWithHistory } from "@/lib/dal/customers";
import { getJobsByCustomer } from "@/lib/dal/jobs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/customers");
  const { id } = await params;

  const [{ data: customer, error }, customerJobs] = await Promise.all([
    getCustomerWithHistory(id),
    getJobsByCustomer(id),
  ]);

  if (error || !customer) {
    notFound();
  }

  return (
    <AppShell
      title={customer.full_name}
      subheading="Customer record, owned equipment, and comprehensive service request history."
    >
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/customers"
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Customers
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/customers/${customer.id}/edit`}>
            <Button variant="secondary" className="text-xs sm:text-sm py-1.5 px-3">
              Edit Customer
            </Button>
          </Link>
          <Link href={`/equipment/new?customerId=${customer.id}`}>
            <Button variant="secondary" className="text-xs sm:text-sm py-1.5 px-3">
              + Register Equipment
            </Button>
          </Link>
          <Link href={`/requests/new?customerId=${customer.id}`}>
            <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
              + New Service Intake
            </Button>
          </Link>
        </div>
      </div>

      {/* Customer Information Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Contact Information"
          action={<StatusBadge label={customer.preferred_contact || "phone"} tone="primary" />}
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Full Name</dt>
              <dd className="mt-1 font-medium text-slate-900">{customer.full_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Phone</dt>
              <dd className="mt-1 text-slate-800">
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="text-blue-600 hover:underline">
                    {customer.phone}
                  </a>
                ) : (
                  <span className="italic text-slate-400">None provided</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Email</dt>
              <dd className="mt-1 text-slate-800">
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">
                    {customer.email}
                  </a>
                ) : (
                  <span className="italic text-slate-400">None provided</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Registered</dt>
              <dd className="mt-1 text-slate-600">
                {new Date(customer.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Notes & Account Terms" className="lg:col-span-2">
          {customer.notes ? (
            <p className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-700">
              {customer.notes}
            </p>
          ) : (
            <p className="italic text-sm text-slate-400">
              No special customer notes or instructions recorded.
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
            <div className="rounded-xl border border-slate-100 bg-white p-3">
              <p className="text-xs text-slate-500">Registered Devices</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{customer.assets.length}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white p-3">
              <p className="text-xs text-slate-500">Service Requests</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{customer.service_requests.length}</p>
            </div>
          </div>
        </Panel>
      </div>

      {/* Owned Equipment Section */}
      <Panel
        title={`Registered Equipment (${customer.assets.length})`}
        action={
          <Link href={`/equipment/new?customerId=${customer.id}`}>
            <Button variant="secondary" className="text-xs py-1 px-2.5">
              + Add Equipment
            </Button>
          </Link>
        }
      >
        {customer.assets.length === 0 ? (
          <EmptyState
            title="No equipment registered"
            description="Register customer appliances or electronic devices to begin tracking repair history."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Brand & Model</th>
                  <th className="px-4 py-3">Serial Number</th>
                  <th className="px-4 py-3">Added</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customer.assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">{asset.category}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {[asset.brand, asset.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {asset.serial_number || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(asset.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/equipment/${asset.id}`}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          View Details
                        </Link>
                        <Link
                          href={`/requests/new?customerId=${customer.id}&assetId=${asset.id}`}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Create Request
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Service Request History Section */}
      <Panel
        title={`Service Requests (${customer.service_requests.length})`}
        action={
          <Link href={`/requests/new?customerId=${customer.id}`}>
            <Button variant="primary" className="text-xs py-1 px-2.5">
              + New Request
            </Button>
          </Link>
        }
      >
        {customer.service_requests.length === 0 ? (
          <EmptyState
            title="No service requests yet"
            description="Submit an intake service request for this customer to begin diagnostics and repair."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Equipment</th>
                  <th className="px-4 py-3">Reported Problem</th>
                  <th className="px-4 py-3">Urgency</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customer.service_requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-semibold text-blue-600">
                      <Link href={`/requests/${req.id}`} className="hover:underline">
                        {req.request_reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <span className="font-medium">{req.equipment_category}</span> &bull; {req.brand_model}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                      {req.reported_problem}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(req.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/requests/${req.id}`}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        View Request
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Repair Jobs Section */}
      <Panel
        title={`Repair Jobs (${customerJobs.length})`}
        action={
          <Link href={`/jobs/new?customerId=${customer.id}`}>
            <Button variant="primary" className="text-xs py-1 px-2.5">
              + New Repair Job
            </Button>
          </Link>
        }
      >
        {customerJobs.length === 0 ? (
          <EmptyState
            title="No repair jobs created yet"
            description="Create a repair job or convert a pending service request to begin workshop repair work."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-4 py-3">Job ID</th>
                  <th className="px-4 py-3">Issue Summary</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customerJobs.map((cj) => (
                  <tr key={cj.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">
                      <Link href={`/jobs/${cj.id}`} className="hover:underline">
                        JOB-{cj.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800 max-w-sm truncate">
                      {cj.issue_summary}
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={cj.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(cj.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/jobs/${cj.id}`}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
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
      </Panel>
    </AppShell>
  );
}
