"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { addDiagnosisAction } from "@/lib/actions/jobs";

export function DiagnosisForm({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrorMsg(null);

    startTransition(async () => {
      const res = await addDiagnosisAction(jobId, formData);
      if (res.success) {
        setIsOpen(false);
      } else {
        setErrorMsg(res.error || "Failed to record diagnosis");
      }
    });
  }

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        onClick={() => setIsOpen(true)}
        className="text-xs py-1.5 px-3"
      >
        + Record Diagnosis
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Record Technical Diagnosis</h4>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          Cancel
        </button>
      </div>

      {errorMsg && (
        <p className="text-xs text-rose-600 font-medium">{errorMsg}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Diagnosis Findings & Inspection Notes *">
          <textarea
            name="notes"
            required
            rows={3}
            placeholder="Detailed findings (e.g., thermal sensor reading abnormal, blown fuse on primary rail)..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500"
          />
        </FormField>

        <FormField label="Root Cause (Optional)">
          <input
            type="text"
            name="rootCause"
            placeholder="e.g. Liquid ingress on DC-in jack, power surge, wear and tear"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500"
          />
        </FormField>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="quiet"
            onClick={() => setIsOpen(false)}
            className="text-xs py-1.5 px-3"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} className="text-xs py-1.5 px-3">
            {isPending ? "Saving..." : "Save Diagnosis"}
          </Button>
        </div>
      </form>
    </div>
  );
}
