import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { requireRole } from "@/lib/auth/server";
import { getQuotationById } from "@/lib/dal/quotations";
import { QuotationStatusBadge } from "@/components/quotations/quotation-status-badge";
import { QuotationActions } from "@/components/quotations/quotation-actions";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/quotations");
  const { id } = await params;

  const { data: quotation, error } = await getQuotationById(id);

  if (error || !quotation) {
    notFound();
  }

  const job = quotation.job;
  const customer = quotation.customer;
  const asset = quotation.asset;
  const approvals = quotation.approvals || [];
  const allVersions = quotation.all_versions || [];

  return (
    <AppShell
      title={`Quotation QT-${quotation.id.slice(0, 8).toUpperCase()}`}
      subheading={`Version v${quotation.version_number} snapshot for Job #${quotation.job_id.slice(0, 8)}`}
    >
      {/* Top action header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <Link
          href="/quotations"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs"
        >
          &larr; Quotations List
        </Link>
        <QuotationActions
          quoteVersionId={quotation.id}
          jobId={quotation.job_id}
          status={quotation.status}
          customerName={customer?.full_name}
        />
      </div>

      {/* Overview Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main 2-column pane */}
        <div className="space-y-6 lg:col-span-2">
          {/* Cost Breakdown Card */}
          <Panel
            title="Financial Breakdown"
            action={<QuotationStatusBadge status={quotation.status} />}
          >
            <div className="space-y-4">
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-sm">
                <div className="flex justify-between py-2 text-slate-600">
                  <span>Labor Charges:</span>
                  <span className="font-medium text-slate-900">
                    ${Number(quotation.labour_charge || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between py-2 text-slate-600">
                  <span>Parts & Replacement Materials:</span>
                  <span className="font-medium text-slate-900">
                    ${Number(quotation.parts_cost || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between py-2 text-slate-600">
                  <span>Taxes:</span>
                  <span className="font-medium text-slate-900">
                    ${Number(quotation.tax_amount || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pt-3 text-base font-bold text-slate-900">
                  <span>Grand Total (Customer Payable):</span>
                  <span className="text-xl text-blue-600">
                    ${Number(quotation.total_amount || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {quotation.notes && (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                    Repair Scope & Notes
                  </h4>
                  <p className="text-sm text-slate-800 whitespace-pre-line">
                    {quotation.notes}
                  </p>
                </div>
              )}
            </div>
          </Panel>

          {/* Related Job Details */}
          <Panel
            title="Associated Repair Job"
            action={
              <Link
                href={`/jobs/${quotation.job_id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Open Job Board &rarr;
              </Link>
            }
          >
            {job ? (
              <div className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-slate-500 block">Job Reference:</span>
                    <span className="font-semibold text-slate-900">Job #{job.id.slice(0, 8)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Current Status:</span>
                    <span className="capitalize font-medium text-slate-700">
                      {job.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block">Customer Reported Problem:</span>
                  <p className="text-slate-800 mt-0.5 italic">{job.issue_summary}</p>
                </div>

                {/* Show any logged parts on this job */}
                {quotation.job_details?.parts_used && quotation.job_details.parts_used.length > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <span className="text-xs font-semibold text-slate-700 block mb-2">
                      Parts Installed / Logged on Job:
                    </span>
                    <ul className="divide-y divide-slate-200 text-xs">
                      {quotation.job_details.parts_used.map((p) => (
                        <li key={p.id} className="flex justify-between py-1 text-slate-600">
                          <span>
                            {p.quantity}x {p.part_name} {p.part_number ? `(${p.part_number})` : ""}
                          </span>
                          <span className="font-medium text-slate-800">
                            ${(Number(p.quantity) * Number(p.unit_cost)).toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No job association found.</p>
            )}
          </Panel>

          {/* Customer Approval Decision History */}
          <Panel title="Customer Response & Authorization Records">
            {approvals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                {quotation.status === "draft"
                  ? "This quotation is in draft and has not yet been sent to the customer."
                  : quotation.status === "sent"
                    ? "Quotation has been delivered. Waiting for customer response."
                    : "No formal approval records logged yet."}
              </div>
            ) : (
              <div className="space-y-3">
                {approvals.map((app) => (
                  <div
                    key={app.id}
                    className={`rounded-lg border p-3.5 text-xs ${
                      app.status === "approved"
                        ? "border-emerald-200 bg-emerald-50/50 text-emerald-900"
                        : "border-rose-200 bg-rose-50/50 text-rose-900"
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>Status: {app.status.toUpperCase()}</span>
                      <span className="text-[11px] font-normal text-slate-500">
                        {app.approved_at
                          ? new Date(app.approved_at).toLocaleString()
                          : new Date(app.created_at).toLocaleString()}
                      </span>
                    </div>
                    {app.comments && (
                      <p className="mt-2 text-slate-700 italic border-t border-slate-200/50 pt-1.5">
                        &ldquo;{app.comments}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Sidebar info pane */}
        <div className="space-y-6">
          {/* Customer & Equipment Card */}
          <Panel title="Customer & Equipment">
            <div className="space-y-4 text-xs">
              <div>
                <span className="text-slate-500 block">Customer Name:</span>
                <span className="font-semibold text-slate-900 text-sm">
                  {customer?.full_name || "Unassigned"}
                </span>
                {customer?.phone && (
                  <p className="text-slate-600 mt-0.5">📞 {customer.phone}</p>
                )}
                {customer?.email && (
                  <p className="text-slate-600 mt-0.5">✉️ {customer.email}</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3">
                <span className="text-slate-500 block">Equipment:</span>
                <span className="font-semibold text-slate-900 text-sm">
                  {asset ? `${asset.brand || ""} ${asset.model || ""}`.trim() || asset.category : "—"}
                </span>
                {asset?.serial_number && (
                  <p className="text-slate-600 mt-0.5">S/N: {asset.serial_number}</p>
                )}
                {asset?.category && (
                  <p className="text-slate-600 mt-0.5">Category: {asset.category}</p>
                )}
              </div>
            </div>
          </Panel>

          {/* Quotation Metadata Card */}
          <Panel title="Quotation Metadata">
            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Version:</span>
                <span className="font-semibold text-slate-900">v{quotation.version_number}</span>
              </div>
              <div className="flex justify-between">
                <span>Created:</span>
                <span>{new Date(quotation.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Last Updated:</span>
                <span>{new Date(quotation.updated_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <span className="capitalize font-semibold text-slate-900">{quotation.status}</span>
              </div>
            </div>
          </Panel>

          {/* Version History Card */}
          <Panel title="Job Version History">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-2">
                All quotation revisions for this repair job:
              </p>
              <div className="divide-y divide-slate-100">
                {allVersions.map((v) => (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between py-2 text-xs ${
                      v.id === quotation.id ? "font-bold text-blue-600" : "text-slate-700"
                    }`}
                  >
                    <div>
                      <Link href={`/quotations/${v.id}`} className="hover:underline">
                        v{v.version_number} — ${Number(v.total_amount).toFixed(2)}
                      </Link>
                      <div className="text-[10px] text-slate-400">
                        {new Date(v.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <QuotationStatusBadge status={v.status} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
