"use client";

import { useActionState, useState } from "react";
import { respondToQuoteCustomerAction } from "@/lib/actions/quotations";

interface CustomerApprovalCardProps {
  quoteVersionId: string;
  totalAmount: number;
  status: string;
}

export function CustomerApprovalCard({
  quoteVersionId,
  totalAmount,
  status,
}: CustomerApprovalCardProps) {
  const [decision, setDecision] = useState<"approved" | "declined" | null>(null);
  const [comments, setComments] = useState<string>("");

  const [state, formAction, isPending] = useActionState(respondToQuoteCustomerAction, {
    success: false,
  });

  if (status === "approved") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-3">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h4 className="text-base font-semibold text-emerald-900">Quotation Approved</h4>
        <p className="mt-1 text-xs text-emerald-700">
          You have successfully approved this quotation. The repair workshop has been notified and scheduled work will begin.
        </p>
      </div>
    );
  }

  if (status === "declined") {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <h4 className="text-base font-semibold text-rose-900">Quotation Declined</h4>
        <p className="mt-1 text-xs text-rose-700">
          This quotation was declined. Please contact the workshop if you would like to discuss alternative repair scopes.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <h3 className="text-base font-semibold text-slate-900 mb-2">Customer Authorization</h3>
      <p className="text-xs text-slate-500 mb-6">
        Please review the cost estimate and repair scope details above. Your digital decision will be recorded directly into the repair history.
      </p>

      {state.error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          Your response has been successfully recorded. Thank you!
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="quote_version_id" value={quoteVersionId} />
        <input type="hidden" name="decision" value={decision || ""} />

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Customer Comments or Instructions (Optional)
          </label>
          <textarea
            name="comments"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add any specific requirements, preferred pickup window, or notes for the technician..."
            className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            onClick={() => setDecision("approved")}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 cursor-pointer disabled:opacity-50 text-center"
          >
            {isPending && decision === "approved" ? "Recording..." : `Approve Quotation ($${totalAmount.toFixed(2)})`}
          </button>

          <button
            type="submit"
            disabled={isPending}
            onClick={() => setDecision("declined")}
            className="rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-50 text-center"
          >
            {isPending && decision === "declined" ? "Recording..." : "Decline Quotation"}
          </button>
        </div>
      </form>
    </div>
  );
}
