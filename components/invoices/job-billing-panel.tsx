"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { recordManualPaymentAction, generateInvoiceFromJobAction } from "@/lib/actions/invoices";
import type { JobBillingData } from "@/lib/dal/invoices";
import type { PaymentMethod } from "@/lib/types/database";

export function JobBillingPanel({
  jobId,
  billing,
  canManageBilling,
}: {
  jobId: string;
  billing: JobBillingData;
  canManageBilling: boolean;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    billing.balanceDue > 0 ? billing.balanceDue.toFixed(2) : ""
  );
  const [paymentRequestKey, setPaymentRequestKey] = useState(() =>
    globalThis.crypto.randomUUID()
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { invoice, payments, totalAmount, totalPaid, balanceDue } = billing;

  function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("job_id", jobId);
    formData.append("amount", amount);
    formData.append("payment_method", method);
    formData.append("payment_request_key", paymentRequestKey);
    if (notes) formData.append("notes", notes.trim());

    startTransition(async () => {
      const res = await recordManualPaymentAction(null, formData);
      if (res.success) {
        setIsModalOpen(false);
        setNotes("");
        setPaymentRequestKey(globalThis.crypto.randomUUID());
      } else {
        setErrorMsg(res.error || "Failed to record payment.");
      }
    });
  }

  function handleCreateInvoice() {
    startTransition(async () => {
      const res = await generateInvoiceFromJobAction(jobId);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to generate invoice.");
      }
    });
  }

  return (
    <Panel
      title="Billing & Invoicing"
      action={
        <div className="flex items-center gap-2">
          {invoice ? (
            <StatusBadge
              label={
                invoice.payment_status === "paid"
                  ? "Fully Paid"
                  : invoice.payment_status === "partially_paid"
                    ? "Partially Paid"
                    : "Payment Pending"
              }
              tone={
                invoice.payment_status === "paid"
                  ? "success"
                  : invoice.payment_status === "partially_paid"
                    ? "warning"
                    : "danger"
              }
            />
          ) : (
            <StatusBadge label="Invoice Pending" tone="neutral" />
          )}

          {canManageBilling && (
            <Button
              variant="primary"
              className="text-xs py-1.5 px-3"
              onClick={() => {
                setAmount(balanceDue > 0 ? balanceDue.toFixed(2) : "");
                setIsModalOpen(true);
              }}
            >
              + Record Payment
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Billing Overview Metric Boxes */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-slate-500 font-medium">Total Invoiced</p>
            <p className="mt-1 text-base font-bold text-slate-900">
              ${totalAmount.toFixed(2)}
            </p>
            {invoice && (
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{invoice.invoice_number}</p>
            )}
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <p className="text-emerald-700 font-medium">Amount Paid</p>
            <p className="mt-1 text-base font-bold text-emerald-800">
              ${totalPaid.toFixed(2)}
            </p>
            <p className="text-[10px] text-emerald-600 mt-0.5">{payments.length} transaction(s)</p>
          </div>
          <div
            className={`rounded-xl border p-3 ${
              balanceDue > 0
                ? "border-rose-100 bg-rose-50/60 text-rose-800"
                : "border-slate-100 bg-slate-50 text-slate-700"
            }`}
          >
            <p className="font-medium opacity-80">Outstanding Balance</p>
            <p className="mt-1 text-base font-bold">
              ${balanceDue.toFixed(2)}
            </p>
            <p className="text-[10px] opacity-75 mt-0.5">
              {balanceDue === 0 ? "Zero Balance" : "Due upon handover"}
            </p>
          </div>
        </div>

        {/* If no invoice generated yet */}
        {!invoice && canManageBilling && (
          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <div>
              <p className="font-semibold text-blue-900">Generate Official Workshop Invoice</p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                Lock approved quote scope and labor into an official invoice number.
              </p>
            </div>
            <Button
              variant="secondary"
              className="text-xs py-1.5 px-3 bg-white"
              disabled={isPending}
              onClick={handleCreateInvoice}
            >
              {isPending ? "Generating..." : "Generate Invoice"}
            </Button>
          </div>
        )}

        {/* Payments History List */}
        <div className="space-y-2">
          <p className="font-semibold uppercase tracking-wider text-slate-500 text-[11px]">
            Payment History & Transactions ({payments.length})
          </p>

          {payments.length === 0 ? (
            <p className="text-slate-400 italic py-2">
              No payments recorded yet for this repair job.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">${Number(p.amount).toFixed(2)}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                        {p.payment_method.replace("_", " ")}
                      </span>
                    </div>
                    {p.notes && <p className="text-slate-500 text-[11px]">{p.notes}</p>}
                  </div>
                  <div className="text-right text-[11px] text-slate-400">
                    <p>{new Date(p.created_at).toLocaleDateString()}</p>
                    {p.recorder && <p className="text-[10px]">by {p.recorder.full_name}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Record Payment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                  Manual Payment Recording
                </span>
                <h3 className="text-base font-bold text-slate-900">Record Customer Payment</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold uppercase tracking-wide text-slate-500">
                  Payment Amount ($) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-200 p-2.5 font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold uppercase tracking-wide text-slate-500">
                  Payment Method *
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-xs bg-white"
                >
                  <option value="cash">Cash (In-person register)</option>
                  <option value="card">Credit / Debit Card (Terminal)</option>
                  <option value="bank_transfer">Bank Wire / Electronic Transfer</option>
                  <option value="mobile_pay">Mobile Payment (Venmo/Zelle/Telebirr)</option>
                  <option value="cheque">Business Cheque</option>
                  <option value="other">Other / Authorized Credit</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold uppercase tracking-wide text-slate-500">
                  Transaction Reference / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Card slip #4829 / Received at front counter..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs py-2 px-3"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="text-xs py-2 px-4 bg-emerald-600 hover:bg-emerald-700"
                >
                  {isPending ? "Recording Payment..." : "Record & Update Balance"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Panel>
  );
}
