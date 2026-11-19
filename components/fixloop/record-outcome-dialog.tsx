"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { recordStaffFollowUpOutcomeAction } from "@/lib/actions/fixloop";
import type { StaffReportedOutcome } from "@/lib/types/database";

export function RecordOutcomeDialog({
  followUpId,
  jobCode,
  customerName,
  customerPhone,
  equipmentName,
}: {
  followUpId: string;
  jobCode: string;
  customerName: string;
  customerPhone?: string | null;
  equipmentName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<StaffReportedOutcome>("working");
  const [notes, setNotes] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const customerMessage = `Hello ${customerName}, this is Kaamflow Workshop following up on your repair (${jobCode}: ${equipmentName}). Is everything operating as expected, or do you notice any issues? Let us know so we can assist!`;

  function handleCopyMessage() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(customerMessage);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 2500);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (selectedOutcome === "different_issue" && (!notes.trim() || !privacyConsent)) {
      setErrorMsg("Add the new issue description and confirm the customer authorized recording it.");
      return;
    }

    const formData = new FormData();
    formData.append("follow_up_id", followUpId);
    formData.append("outcome", selectedOutcome);
    if (notes) formData.append("notes", notes.trim());
    formData.append("privacy_consent", String(privacyConsent));

    startTransition(async () => {
      const res = await recordStaffFollowUpOutcomeAction(null, formData);
      if (res.success) {
        setIsOpen(false);
      } else {
        setErrorMsg(res.error || "Failed to record follow-up outcome.");
      }
    });
  }

  return (
    <>
      <Button
        variant="primary"
        className="text-xs py-1.5 px-3"
        onClick={() => setIsOpen(true)}
      >
        Record Outcome
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-purple-600">
                  FixLoop Outcome Recording
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  {jobCode} &bull; {customerName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {equipmentName} {customerPhone ? `• ${customerPhone}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {/* Quick Copyable Message for WhatsApp/SMS */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900">
                  Customer Outreach Message (WhatsApp / SMS)
                </span>
                <button
                  type="button"
                  onClick={handleCopyMessage}
                  className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  {copiedMessage ? "✓ Copied to Clipboard!" : "Copy Message"}
                </button>
              </div>
              <p className="font-mono text-[11px] text-slate-700 bg-white p-2 rounded border border-blue-100/60 leading-relaxed">
                {customerMessage}
              </p>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Customer Reported Outcome *
                </label>
                <div className="space-y-1.5">
                  {[
                    {
                      value: "working",
                      label: "Working as expected",
                      hint: "Confirmed successful repair — enters positive outcome rate.",
                      badgeTone: "bg-emerald-100 text-emerald-800 border-emerald-300",
                    },
                    {
                      value: "same_symptom",
                      label: "Same symptom returned",
                      hint: "Automatically creates a Comeback Case linked to the original repair job.",
                      badgeTone: "bg-rose-100 text-rose-800 border-rose-300",
                    },
                    {
                      value: "partly",
                      label: "Partly improved",
                      hint: "Customer reports partial improvement; flagged for technician review.",
                      badgeTone: "bg-amber-100 text-amber-800 border-amber-300",
                    },
                    {
                      value: "different_issue",
                      label: "Different issue emerged",
                      hint: "Creates a new separate Service Request linked to customer and asset.",
                      badgeTone: "bg-blue-100 text-blue-800 border-blue-300",
                    },
                    {
                      value: "no_response",
                      label: "No response after outreach",
                      hint: "Remains unknown; strictly excluded from confirmed success metrics.",
                      badgeTone: "bg-slate-100 text-slate-700 border-slate-300",
                    },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition text-xs ${
                        selectedOutcome === option.value
                          ? `${option.badgeTone} ring-1 ring-offset-1`
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="outcome"
                        value={option.value}
                        checked={selectedOutcome === option.value}
                        onChange={() => setSelectedOutcome(option.value as StaffReportedOutcome)}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <p className="font-bold">{option.label}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                          {option.hint}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Customer Comments / Follow-up Notes
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record customer's exact words, symptoms, or communication date..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>

              {selectedOutcome === "different_issue" && (
                <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                  <input
                    type="checkbox"
                    checked={privacyConsent}
                    onChange={(event) => setPrivacyConsent(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    The customer authorized us to record this new issue and use their contact details to create a service request.
                  </span>
                </label>
              )}

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
                  disabled={isPending}
                  className="text-xs py-2 px-4 bg-purple-600 hover:bg-purple-700"
                >
                  {isPending ? "Recording..." : "Record Outcome"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
