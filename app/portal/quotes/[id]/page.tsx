import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { requireAuth } from "@/lib/auth/server";
import { getQuotationById } from "@/lib/dal/quotations";
import { QuotationStatusBadge } from "@/components/quotations/quotation-status-badge";
import { CustomerApprovalCard } from "@/components/quotations/customer-approval-card";

export default async function CustomerQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAuth("/portal/quotes");
  const { id } = await params;

  const { data: quotation, error } = await getQuotationById(id);

  if (error || !quotation) {
    notFound();
  }

  // Security check: If caller is a customer, verify ownership of quotation
  if (session.profile.role === "CUSTOMER") {
    const customerId = session.profile.customer_id;
    const isOwner =
      quotation.customer?.id === customerId ||
      quotation.quote_delivery?.customer_id === customerId ||
      quotation.job?.customer_id === customerId;

    if (!isOwner) {
      redirect("/unauthorized?reason=quote_not_owned");
    }
  }

  const asset = quotation.asset;

  return (
    <AppShell
      title={`Review Repair Quotation QT-${quotation.id.slice(0, 8).toUpperCase()}`}
      subheading="Please review the proposed labor, replacement parts, and estimated repair costs."
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link
            href="/portal/quotes"
            className="inline-flex items-center text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            &larr; Back to My Quotes
          </Link>
        </div>

        {/* Cost Summary Banner */}
        <Panel
          title="Quotation Summary"
          action={<QuotationStatusBadge status={quotation.status} />}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-slate-100 bg-slate-50 p-4 text-xs">
              <div>
                <span className="text-slate-500 block">Equipment:</span>
                <span className="font-semibold text-slate-900 text-sm">
                  {asset ? `${asset.brand || ""} ${asset.model || ""}`.trim() || asset.category : "Device"}
                </span>
                {asset?.serial_number && (
                  <span className="text-slate-500 block mt-0.5">S/N: {asset.serial_number}</span>
                )}
              </div>
              <div>
                <span className="text-slate-500 block">Repair Job Reference:</span>
                <span className="font-semibold text-slate-900 text-sm">
                  Job #{quotation.job_id.slice(0, 8)}
                </span>
                <span className="text-slate-500 block mt-0.5">
                  Version: v{quotation.version_number}
                </span>
              </div>
            </div>

            {/* Financial itemization */}
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <div className="flex justify-between py-2 text-slate-600">
                <span>Labor Charges:</span>
                <span className="font-semibold text-slate-900">
                  ${Number(quotation.labour_charge || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between py-2 text-slate-600">
                <span>Parts & Materials:</span>
                <span className="font-semibold text-slate-900">
                  ${Number(quotation.parts_cost || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between py-2 text-slate-600">
                <span>Taxes:</span>
                <span className="font-semibold text-slate-900">
                  ${Number(quotation.tax_amount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between pt-3 text-base font-bold text-slate-900">
                <span>Total Amount:</span>
                <span className="text-xl text-blue-600">
                  ${Number(quotation.total_amount || 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Scope / Notes */}
            {quotation.notes && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                  Scope of Work & Notes
                </h4>
                <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                  {quotation.notes}
                </p>
              </div>
            )}
          </div>
        </Panel>

        {/* Customer Decision Form */}
        <CustomerApprovalCard
          quoteVersionId={quotation.id}
          totalAmount={Number(quotation.total_amount || 0)}
          status={quotation.status}
        />
      </div>
    </AppShell>
  );
}
