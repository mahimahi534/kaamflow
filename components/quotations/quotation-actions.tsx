"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendQuotationAction, recordStaffApprovalAction } from "@/lib/actions/quotations";
import type { QuoteStatus } from "@/lib/types/database";

interface QuotationActionsProps {
  quoteVersionId: string;
  jobId: string;
  status: QuoteStatus;
  customerName?: string;
}

export function QuotationActions({
  quoteVersionId,
  jobId,
  status,
  customerName,
}: QuotationActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState<"approved" | "declined" | null>(null);
  const [offlineComments, setOfflineComments] = useState<string>("");

  function handleSend() {
    if (!confirm("Are you sure you want to send this quotation to the customer? The job will transition to 'Awaiting Customer Approval'.")) {
      return;
    }
    setErrorMessage(null);
    startTransition(async () => {
      const res = await sendQuotationAction(quoteVersionId);
      if (!res.success) {
        setErrorMessage(res.error || "Failed to send quotation.");
      }
    });
  }

  function handleRecordOfflineApproval(e: React.FormEvent) {
    e.preventDefault();
    if (!showRecordModal) return;

    setErrorMessage(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("quote_version_id", quoteVersionId);
      fd.set("decision", showRecordModal);
      fd.set("comments", offlineComments);

      const res = await recordStaffApprovalAction({ success: false }, fd);
      if (!res.success) {
        setErrorMessage(res.error || "Failed to record approval.");
      } else {
        setShowRecordModal(null);
        setOfflineComments("");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {errorMessage && (
        <div className="w-full rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          {errorMessage}
        </div>
      )}

      {/* If Draft: Can Send */}
      {status === "draft" && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 cursor-pointer disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send to Customer"}
        </button>
      )}

      {/* If Sent: Staff can record verbal/offline response */}
      {status === "sent" && (
        <>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowRecordModal("approved")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
          >
            Record Approval
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowRecordModal("declined")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 cursor-pointer disabled:opacity-50"
          >
            Record Decline
          </button>
        </>
      )}

      {/* Revision Button: Create a new version for this job */}
      <Link
        href={`/quotations/new?jobId=${jobId}&revisionFrom=${quoteVersionId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs"
      >
        Create New Revision
      </Link>

      <Link
        href={`/jobs/${jobId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
      >
        View Repair Job
      </Link>

      {/* Modal for Recording Offline Customer Decision */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Record Verbal Customer {showRecordModal === "approved" ? "Approval" : "Decline"}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Recording offline confirmation received from {customerName || "the customer"} (e.g. via phone call or in-person workshop visit).
            </p>

            <form onSubmit={handleRecordOfflineApproval} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Notes or Staff Verification Reference
                </label>
                <textarea
                  rows={3}
                  value={offlineComments}
                  onChange={(e) => setOfflineComments(e.target.value)}
                  placeholder="e.g. Spoke with customer via phone at 2:30pm; agreed to replacement parts cost."
                  required
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRecordModal(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow-xs cursor-pointer ${
                    showRecordModal === "approved"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-600 hover:bg-rose-700"
                  }`}
                >
                  {isPending ? "Recording..." : `Confirm ${showRecordModal === "approved" ? "Approval" : "Decline"}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
