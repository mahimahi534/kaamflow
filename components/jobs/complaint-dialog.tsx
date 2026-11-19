"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function ComplaintDialog({
  jobId,
  customerId,
  onComplaintLogged,
}: {
  jobId: string;
  customerId?: string | null;
  onComplaintLogged?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [complaintText, setComplaintText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const { logComplaintAction } = await import("@/lib/actions/jobs");

    startTransition(async () => {
      const res = await logComplaintAction({
        jobId,
        customerId: customerId || undefined,
        complaintText: complaintText.trim(),
      });

      if (res.success) {
        setIsOpen(false);
        setComplaintText("");
        onComplaintLogged?.();
      } else {
        setErrorMsg(res.error || "Failed to log complaint.");
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        className="text-xs py-1.5 px-3 text-rose-700 hover:bg-rose-50"
        onClick={() => setIsOpen(true)}
      >
        + Log Customer Complaint / Dispute
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-rose-600">
                  Customer Dispute Tracking
                </span>
                <h3 className="text-base font-bold text-slate-900">Log Formal Complaint</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">
                  Customer Statement / Dispute Details *
                </label>
                <textarea
                  rows={4}
                  required
                  value={complaintText}
                  onChange={(e) => setComplaintText(e.target.value)}
                  placeholder="Record customer's exact complaint statement regarding repair quality, delay, pricing, or device handling..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                />
                <p className="text-[10px] text-slate-400">
                  Logged complaints remain in the permanent job history for compliance and dispute resolution.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs py-2 px-3"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || !complaintText.trim()}
                  className="text-xs py-2 px-4 bg-rose-600 hover:bg-rose-700"
                >
                  {isPending ? "Logging Dispute..." : "Record Complaint"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
