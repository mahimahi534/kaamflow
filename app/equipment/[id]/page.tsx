import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getAssetById } from "@/lib/dal/equipment";
import { getJobsByAsset } from "@/lib/dal/jobs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/equipment");
  const { id } = await params;

  const [{ data: asset, error }, assetJobs] = await Promise.all([
    getAssetById(id),
    getJobsByAsset(id),
  ]);

  if (error || !asset) {
    notFound();
  }

  const titleName = [asset.brand, asset.model].filter(Boolean).join(" ") || asset.category;

  return (
    <AppShell
      title={titleName}
      subheading={`${asset.category} equipment record and diagnostic service history.`}
    >
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/equipment"
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Equipment
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/equipment/${asset.id}/edit`}>
            <Button variant="secondary" className="text-xs sm:text-sm py-1.5 px-3">
              Edit Equipment
            </Button>
          </Link>
          {asset.customer ? (
            <Link href={`/requests/new?customerId=${asset.customer.id}&assetId=${asset.id}`}>
              <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                + New Service Intake
              </Button>
            </Link>
          ) : (
            <Link href={`/requests/new?assetId=${asset.id}`}>
              <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                + New Service Intake
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Equipment Specifications & Customer Card */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Equipment Specifications"
          action={<StatusBadge label={asset.category} tone="primary" />}
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Category</dt>
              <dd className="mt-1 font-semibold text-slate-900">{asset.category}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Brand</dt>
              <dd className="mt-1 text-slate-800">{asset.brand || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Model</dt>
              <dd className="mt-1 text-slate-800">{asset.model || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Serial Number</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-900">
                {asset.serial_number ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5">
                    {asset.serial_number}
                  </span>
                ) : (
                  <span className="italic text-slate-400">None</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Registered</dt>
              <dd className="mt-1 text-slate-600">
                {new Date(asset.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Customer Owner"
          className="lg:col-span-2"
          action={
            asset.customer ? (
              <Link
                href={`/customers/${asset.customer.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                View Customer Profile &rarr;
              </Link>
            ) : undefined
          }
        >
          {asset.customer ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <p className="text-base font-bold text-slate-900">{asset.customer.full_name}</p>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
                  {asset.customer.phone && (
                    <span>
                      <strong className="font-medium text-slate-700">Phone:</strong> {asset.customer.phone}
                    </span>
                  )}
                  {asset.customer.email && (
                    <span>
                      <strong className="font-medium text-slate-700">Email:</strong> {asset.customer.email}
                    </span>
                  )}
                </div>
              </div>

              {asset.customer.notes ? (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">Owner Notes</p>
                  <p className="mt-1 text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    {asset.customer.notes}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-6 text-center text-slate-400 italic">
              No owner assigned to this equipment record.
            </div>
          )}
        </Panel>
      </div>

      {/* Service Request History for this Equipment */}
      <Panel
        title={`Service & Repair History (${asset.service_requests.length})`}
        action={
          <Link
            href={
              asset.customer
                ? `/requests/new?customerId=${asset.customer.id}&assetId=${asset.id}`
                : `/requests/new?assetId=${asset.id}`
            }
          >
            <Button variant="primary" className="text-xs py-1 px-2.5">
              + New Service Intake
            </Button>
          </Link>
        }
      >
        {asset.service_requests.length === 0 ? (
          <EmptyState
            title="No service requests on record"
            description="Submit an intake request for this equipment to track diagnostics, repair jobs, and part replacements."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Reported Problem</th>
                  <th className="px-4 py-3">Urgency</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {asset.service_requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-semibold text-blue-600">
                      <Link href={`/requests/${req.id}`} className="hover:underline">
                        {req.request_reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-sm truncate">
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

      {/* Repair Jobs Section for this Asset */}
      <Panel
        title={`Repair Jobs for this Equipment (${assetJobs.length})`}
        action={
          <Link
            href={
              asset.customer
                ? `/jobs/new?customerId=${asset.customer.id}&assetId=${asset.id}`
                : `/jobs/new?assetId=${asset.id}`
            }
          >
            <Button variant="primary" className="text-xs py-1 px-2.5">
              + New Repair Job
            </Button>
          </Link>
        }
      >
        {assetJobs.length === 0 ? (
          <EmptyState
            title="No repair jobs created for this device"
            description="Create a repair ticket to record bench diagnoses, technician work logs, and parts replaced."
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
                {assetJobs.map((aj) => (
                  <tr key={aj.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">
                      <Link href={`/jobs/${aj.id}`} className="hover:underline">
                        JOB-{aj.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800 max-w-sm truncate">
                      {aj.issue_summary}
                    </td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={aj.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(aj.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/jobs/${aj.id}`}
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
