import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/server";
import { getServiceRequestById } from "@/lib/dal/service-requests";
import { convertServiceRequestToJobAction } from "@/lib/actions/jobs";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/requests");
  const { id } = await params;

  const { data: request, error } = await getServiceRequestById(id);

  if (error || !request) {
    notFound();
  }

  return (
    <AppShell
      title={`Request ${request.request_reference}`}
      subheading="Customer repair intake record, reported symptoms, and operational urgency triage."
    >
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/requests"
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Service Requests
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/requests/${request.id}/edit`}>
            <Button variant="secondary" className="text-xs sm:text-sm py-1.5 px-3">
              Edit Request
            </Button>
          </Link>
          <form action={convertServiceRequestToJobAction.bind(null, request.id)}>
            <Button type="submit" variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
              + Convert to Repair Job
            </Button>
          </form>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Customer Info */}
        <Panel
          title="Customer Contact"
          action={
            request.customer ? (
              <Link
                href={`/customers/${request.customer.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                View Profile &rarr;
              </Link>
            ) : (
              <StatusBadge label="Guest Intake" tone="neutral" />
            )
          }
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Customer Name</dt>
              <dd className="mt-1 font-semibold text-slate-900">{request.customer_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Contact Phone</dt>
              <dd className="mt-1 text-slate-800">
                <a href={`tel:${request.phone}`} className="text-blue-600 hover:underline">
                  {request.phone}
                </a>
              </dd>
            </div>
            {request.customer?.email && (
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-400">Email Address</dt>
                <dd className="mt-1 text-slate-800">
                  <a href={`mailto:${request.customer.email}`} className="text-blue-600 hover:underline">
                    {request.customer.email}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Account Status</dt>
              <dd className="mt-1 text-slate-600">
                {request.customer ? "Registered Account" : "Unlinked Intake"}
              </dd>
            </div>
          </dl>
        </Panel>

        {/* Equipment Info */}
        <Panel
          title="Equipment Specification"
          action={
            request.asset ? (
              <Link
                href={`/equipment/${request.asset.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                View Asset &rarr;
              </Link>
            ) : (
              <StatusBadge label="Unregistered Asset" tone="neutral" />
            )
          }
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Category</dt>
              <dd className="mt-1 font-semibold text-slate-900">{request.equipment_category}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Brand & Model</dt>
              <dd className="mt-1 text-slate-800">{request.brand_model}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Serial Tag</dt>
              <dd className="mt-1 font-mono text-slate-700">
                {request.asset?.serial_number ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5">
                    {request.asset.serial_number}
                  </span>
                ) : (
                  <span className="italic text-slate-400">Not recorded</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Asset Registry</dt>
              <dd className="mt-1 text-slate-600">
                {request.asset ? "Linked to Equipment Registry" : "Not yet linked"}
              </dd>
            </div>
          </dl>
        </Panel>

        {/* Triage & Priority */}
        <Panel
          title="Triage & Urgency"
          action={
            <StatusBadge
              label={request.urgency.toUpperCase()}
              tone={
                request.urgency === "urgent"
                  ? "danger"
                  : request.urgency === "high"
                    ? "warning"
                    : request.urgency === "medium"
                      ? "primary"
                      : "neutral"
              }
            />
          }
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Reference ID</dt>
              <dd className="mt-1 font-mono font-bold text-blue-600">{request.request_reference}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Appointment Window</dt>
              <dd className="mt-1 text-slate-800">
                {request.preferred_appointment ? (
                  new Date(request.preferred_appointment).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                ) : (
                  <span className="italic text-slate-400">No preference requested</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Intake Timestamp</dt>
              <dd className="mt-1 text-slate-600">
                {new Date(request.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-400">Privacy Consent</dt>
              <dd className="mt-1">
                {request.privacy_consent ? (
                  <span className="inline-flex items-center text-xs font-semibold text-emerald-700">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Consent Documented
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">Consent pending signature</span>
                )}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      {/* Reported Problem Details */}
      <Panel title="Reported Symptoms & Issue Description">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="whitespace-pre-wrap text-base text-slate-900 leading-relaxed">
            {request.reported_problem}
          </p>
        </div>
      </Panel>
    </AppShell>
  );
}
