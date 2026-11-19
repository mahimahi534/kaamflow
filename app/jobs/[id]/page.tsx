import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getJobById } from "@/lib/dal/jobs";
import { getTechnicians } from "@/lib/dal/technicians";
import { getQuotationsByJob } from "@/lib/dal/quotations";
import { getJobBilling } from "@/lib/dal/invoices";
import { getActiveTrackingTokensForJob } from "@/lib/actions/tracking";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { JobStatusUpdater } from "@/components/jobs/job-status-updater";
import { QuotationStatusBadge } from "@/components/quotations/quotation-status-badge";
import { AssignTechnicianDialog } from "@/components/jobs/assign-technician-dialog";
import { DiagnosisForm } from "@/components/jobs/diagnosis-form";
import { RepairLogForm } from "@/components/jobs/repair-log-form";
import { PartUsedForm } from "@/components/jobs/part-used-form";
import { JobBillingPanel } from "@/components/invoices/job-billing-panel";
import { JobTrackingPanel } from "@/components/tracking/job-tracking-panel";
import { PartsWaitingDialog } from "@/components/jobs/parts-waiting-dialog";
import { ComplaintDialog } from "@/components/jobs/complaint-dialog";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(
    ["OWNER_ADMIN", "DISPATCHER", "TECHNICIAN", "QC_REVIEWER"],
    "/jobs"
  );
  const businessId = session.profile.business_id;
  const { id } = await params;
  const userRole = session.profile.role;
  const canManageDispatch =
    userRole === "OWNER_ADMIN" || userRole === "DISPATCHER";
  const canSeeFinancials = canManageDispatch;
  const canRecordWorkshopActivity =
    canManageDispatch || userRole === "TECHNICIAN";
  const canUpdateJobStatus =
    canManageDispatch || userRole === "TECHNICIAN";

  const [
    { data: job, error },
    { data: technicianList },
    { data: quoteList },
    billing,
    trackingTokens,
  ] = await Promise.all([
    getJobById(id),
    canManageDispatch ? getTechnicians(businessId) : Promise.resolve({ data: [] }),
    canSeeFinancials ? getQuotationsByJob(id) : Promise.resolve({ data: [] }),
    canSeeFinancials ? getJobBilling(id) : Promise.resolve(null),
    canManageDispatch ? getActiveTrackingTokensForJob(id) : Promise.resolve([]),
  ]);

  if (error || !job) {
    notFound();
  }

  const jobShortCode = `JOB-${job.id.slice(0, 8).toUpperCase()}`;
  const totalPartsCost = canSeeFinancials
    ? job.parts_used.reduce(
        (sum, part) => sum + Number(part.unit_cost || 0) * Number(part.quantity),
        0
      )
    : null;

  return (
    <AppShell
      title={jobShortCode}
      subheading={job.issue_summary}
    >
      {/* Top action & status header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <Link
          href="/jobs"
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Jobs Board
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-slate-400">Current Status:</span>
            <JobStatusBadge status={job.status} />
          </div>
          {canUpdateJobStatus && <div className="border-l border-slate-200 pl-3">
            <JobStatusUpdater
              jobId={job.id}
              currentStatus={job.status}
              userRole={userRole}
            />
          </div>}
        </div>
      </div>

      {/* 4 Overview Columns */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {/* Customer Panel */}
        <Panel
          title="Customer"
          action={
            job.customer ? (
              <Link
                href={`/customers/${job.customer.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Profile &rarr;
              </Link>
            ) : null
          }
        >
          {job.customer ? (
            <div className="space-y-2 text-sm">
              <p className="font-bold text-slate-900">{job.customer.full_name}</p>
              {job.customer.phone && (
                <p className="text-xs text-slate-600">
                  {job.customer.phone.includes("[Protected]") ? (
                    <span className="font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {job.customer.phone}
                    </span>
                  ) : (
                    <a href={`tel:${job.customer.phone}`} className="text-blue-600 hover:underline">
                      {job.customer.phone}
                    </a>
                  )}
                </p>
              )}
              {canSeeFinancials && job.customer.email && (
                <p className="text-xs text-slate-600 truncate">
                  <a href={`mailto:${job.customer.email}`} className="text-blue-600 hover:underline">
                    {job.customer.email}
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">No customer account linked</p>
          )}
        </Panel>

        {/* Equipment Panel */}
        <Panel
          title="Equipment Under Repair"
          action={
            job.asset ? (
              <Link
                href={`/equipment/${job.asset.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Asset Details &rarr;
              </Link>
            ) : null
          }
        >
          {job.asset ? (
            <div className="space-y-1 text-sm">
              <p className="font-bold text-slate-900">{job.asset.category}</p>
              <p className="text-xs text-slate-700">
                {job.asset.brand || ""} {job.asset.model || ""}
              </p>
              {job.asset.serial_number && (
                <p className="text-[11px] font-mono text-slate-500 mt-1">
                  SN: {job.asset.serial_number}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">No asset registered</p>
          )}
        </Panel>

        {/* Intake Service Request Panel */}
        <Panel
          title="Intake Request"
          action={
            job.service_request ? (
              <Link
                href={`/requests/${job.service_request.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Intake Form &rarr;
              </Link>
            ) : null
          }
        >
          {job.service_request ? (
            <div className="space-y-1 text-sm">
              <p className="font-mono font-bold text-blue-600">
                {job.service_request.request_reference}
              </p>
              <div className="mt-1">
                <StatusBadge
                  label={`Urgency: ${job.service_request.urgency.toUpperCase()}`}
                  tone={job.service_request.urgency === "urgent" ? "danger" : "warning"}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Directly scheduled job</p>
          )}
        </Panel>

        {/* Assigned Technician Panel */}
        <Panel
          title="Assigned Technician"
          action={
            job.active_assignment?.technician ? (
              <StatusBadge label="Assigned" tone="success" />
            ) : (
              <StatusBadge label="Pending" tone="warning" />
            )
          }
        >
          {job.active_assignment?.technician ? (
            <div className="space-y-2 text-sm">
              <p className="font-bold text-slate-900">
                {job.active_assignment.technician.full_name}
              </p>
              {canManageDispatch && <p className="text-xs text-slate-500">
                {job.active_assignment.technician.email}
              </p>}
              {canManageDispatch && (
                <div className="pt-2">
                  <AssignTechnicianDialog
                    jobId={job.id}
                    currentAssignment={job.active_assignment}
                    technicians={technicianList}
                  />
                </div>
              )}
            </div>
          ) : canManageDispatch ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-700 font-medium">Assign a bench technician to start repair:</p>
              <AssignTechnicianDialog
                jobId={job.id}
                technicians={technicianList}
              />
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">No technician assigned yet</p>
          )}
        </Panel>
      </div>

      {/* Main Repair Sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Technical Diagnosis Section */}
        <Panel
          title="Technical Diagnosis & Root Cause"
          action={canRecordWorkshopActivity ? <DiagnosisForm jobId={job.id} /> : null}
        >
          {job.diagnoses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              <p className="font-semibold text-slate-700">No diagnosis recorded yet</p>
              <p className="mt-1 text-xs text-slate-400">
                Technicians can isolate the fault, document root causes, and meter readings.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {job.diagnoses.map((diag) => (
                <div key={diag.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {diag.technician?.full_name || "Bench Technician"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(diag.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{diag.notes}</p>
                  {diag.root_cause && (
                    <div className="mt-2 rounded-lg bg-amber-50/80 p-2 text-xs text-amber-900 border border-amber-200/50">
                      <strong>Root Cause:</strong> {diag.root_cause}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Action Taken & Repair Logs */}
        <Panel
          title="Repair Actions Log"
          action={canRecordWorkshopActivity ? <RepairLogForm jobId={job.id} /> : null}
        >
          {job.repair_logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              <p className="font-semibold text-slate-700">No repair steps logged yet</p>
              <p className="mt-1 text-xs text-slate-400">
                Log work steps, part installations, adjustments, and bench testing procedures.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {job.repair_logs.map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{log.action}</p>
                    <span className="text-[11px] text-slate-400">
                      {new Date(log.created_at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {log.notes && (
                    <p className="mt-1 text-xs text-slate-600">{log.notes}</p>
                  )}
                  {log.technician && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Logged by {log.technician.full_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Quotation & Customer Approval Workflow */}
      {canSeeFinancials && <Panel
        title={`Quotation & Customer Approval (${(quoteList || []).length})`}
        action={
          <Link
            href={`/quotations/new?jobId=${job.id}`}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
          >
            + Create Quotation
          </Link>
        }
      >
        {!quoteList || quoteList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">No quotation created for this job yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Generate a formal price estimate from diagnostic labor and parts to send for customer approval.
            </p>
            <div className="mt-3">
              <Link
                href={`/quotations/new?jobId=${job.id}`}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
              >
                Draft First Quotation
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {quoteList.map((q) => (
              <div
                key={q.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3 hover:bg-slate-50/70"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/quotations/${q.id}`}
                      className="font-bold text-blue-600 hover:underline text-sm"
                    >
                      QT-{q.id.slice(0, 8).toUpperCase()} (v{q.version_number})
                    </Link>
                    <QuotationStatusBadge status={q.status} size="sm" />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Created {new Date(q.created_at).toLocaleDateString()} &bull; Labor: $
                    {Number(q.labour_charge).toFixed(2)} &bull; Parts: $
                    {Number(q.parts_cost).toFixed(2)} &bull; Tax: $
                    {Number(q.tax_amount).toFixed(2)}
                  </div>
                  {q.notes && (
                    <p className="mt-1 text-xs text-slate-700 line-clamp-1 italic">
                      {q.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 sm:text-right">
                  <div>
                    <span className="text-xs text-slate-400 block uppercase font-medium">Total</span>
                    <span className="text-base font-bold text-slate-900">
                      ${Number(q.total_amount).toFixed(2)}
                    </span>
                  </div>
                  <Link
                    href={`/quotations/${q.id}`}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-xs"
                  >
                    View Details &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>}

      {/* Parts Used & Materials Tracking */}
      <Panel
        title={`Parts & Materials Used (${job.parts_used.length})`}
        action={
          <div className="flex items-center gap-3">
            {totalPartsCost !== null && (
              <span className="text-sm font-bold text-slate-900">
                Total: ${totalPartsCost.toFixed(2)}
              </span>
            )}
            {canRecordWorkshopActivity && (
              <PartUsedForm jobId={job.id} canEnterCost={canSeeFinancials} />
            )}
            {canManageDispatch && <PartsWaitingDialog jobId={job.id} />}
          </div>
        }
      >
        {job.parts_used.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">No parts recorded for this repair</p>
            <p className="mt-1 text-xs text-slate-400">
              Record consumed parts, replacement components, and quantities for quotation and invoice billing.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-4 py-3">Part Name</th>
                  <th className="px-4 py-3">Part Number</th>
                  <th className="px-4 py-3 text-center">Quantity</th>
                  {canSeeFinancials && <th className="px-4 py-3 text-right">Unit Cost</th>}
                  {canSeeFinancials && <th className="px-4 py-3 text-right">Subtotal</th>}
                  <th className="px-4 py-3">Date Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {job.parts_used.map((part) => (
                  <tr key={part.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-900">{part.part_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {part.part_number || "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-medium">{part.quantity}</td>
                    {canSeeFinancials && (
                      <>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          ${Number(part.unit_cost || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          ${(Number(part.unit_cost || 0) * Number(part.quantity)).toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(part.used_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Billing & Invoicing Panel */}
      {canSeeFinancials && billing && <JobBillingPanel
        jobId={job.id}
        billing={billing}
        canManageBilling={canManageDispatch}
      />}

      {/* Customer Tracking Link Panel */}
      {canManageDispatch && <JobTrackingPanel
        jobId={job.id}
        trackingTokens={trackingTokens}
        canManage={canManageDispatch}
      />}

      {/* Administrative Actions Section */}
      {canManageDispatch && (
        <Panel title="Administrative Actions">
          <div className="flex flex-wrap gap-3">
            <ComplaintDialog
              jobId={job.id}
              customerId={job.customer_id}
            />
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
