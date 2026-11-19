"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitQcInspectionAction } from "@/lib/actions/quality-control";

interface ChecklistItem {
  id: string;
  label: string;
  critical: boolean;
}

export function QcInspectionDialog({
  jobId,
  jobCode,
  equipmentName,
  checklistItems,
  onInspectionSubmitted,
}: {
  jobId: string;
  jobCode: string;
  equipmentName: string;
  checklistItems: ChecklistItem[];
  onInspectionSubmitted?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleCheck(id: string) {
    setCheckedMap((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function handleQuickPassAll() {
    const allChecked: Record<string, boolean> = {};
    checklistItems.forEach((item) => {
      allChecked[item.id] = true;
    });
    setCheckedMap(allChecked);
    setPassed(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passed === null) {
      setErrorMsg("Please select whether the inspection has Passed or Failed.");
      return;
    }

    // If failed, comments are required
    if (!passed && !comments.trim()) {
      setErrorMsg("Please provide inspection notes explaining what failed for technician rework.");
      return;
    }

    setErrorMsg(null);

    const formData = new FormData();
    formData.append("job_id", jobId);
    formData.append("passed", passed ? "true" : "false");
    formData.append("checklist", JSON.stringify(checkedMap));
    if (comments) formData.append("comments", comments.trim());

    startTransition(async () => {
      const res = await submitQcInspectionAction(null, formData);
      if (res.success) {
        setIsOpen(false);
        onInspectionSubmitted?.();
      } else {
        setErrorMsg(res.error || "Failed to submit QC inspection.");
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
        Inspect / QC Review
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
                  Quality Control Review
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {jobCode}: {equipmentName}
                </h3>
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
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Checklist Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Category Inspection Checklist
                  </label>
                  <button
                    type="button"
                    onClick={handleQuickPassAll}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Check all as passed
                  </button>
                </div>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 p-2 max-h-52 overflow-y-auto">
                  {checklistItems.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 py-2 px-2 hover:bg-white rounded-lg cursor-pointer transition text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(checkedMap[item.id])}
                        onChange={() => toggleCheck(item.id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1 text-slate-800">
                        {item.label}
                        {item.critical && (
                          <span className="ml-1 text-[10px] font-semibold text-rose-600 uppercase">
                            (Critical)
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Pass / Fail Radio Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Final Inspection Decision *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center justify-center gap-2 rounded-xl border p-3 cursor-pointer text-xs font-bold transition ${
                      passed === true
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      checked={passed === true}
                      onChange={() => setPassed(true)}
                      className="sr-only"
                    />
                    <span>✓ Passed (Ready for Handover)</span>
                  </label>

                  <label
                    className={`flex items-center justify-center gap-2 rounded-xl border p-3 cursor-pointer text-xs font-bold transition ${
                      passed === false
                        ? "border-rose-500 bg-rose-50 text-rose-800 ring-1 ring-rose-500"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      checked={passed === false}
                      onChange={() => setPassed(false)}
                      className="sr-only"
                    />
                    <span>✕ Failed (Route to Rework)</span>
                  </label>
                </div>
              </div>

              {/* Inspector Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Inspection Comments & Evidence Notes {passed === false ? "*" : "(Optional)"}
                </label>
                <textarea
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder={
                    passed === false
                      ? "Detail exact defect symptoms and required rework steps for the technician..."
                      : "Verified all functions operating within factory tolerances. Ready for customer pickup."
                  }
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
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
                  disabled={isPending || passed === null}
                  className={`text-xs py-2 px-4 ${
                    passed === false
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {isPending
                    ? "Recording..."
                    : passed === false
                      ? "Submit Failure & Route to Rework"
                      : "Record QC Pass"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
