"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { addRepairLogAction } from "@/lib/actions/jobs";

export function RepairLogForm({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrorMsg(null);

    startTransition(async () => {
      const res = await addRepairLogAction(jobId, formData);
      if (res.success) {
        setIsOpen(false);
      } else {
        setErrorMsg(res.error || "Failed to add repair log");
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
        + Log Repair Action
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Log Action Taken</h4>
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
        <FormField label="Action Taken *">
          <input
            type="text"
            name="action"
            required
            placeholder="e.g. Replaced DC power jack, cleaned cooling fins, tested boot sequence"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500"
          />
        </FormField>

        <FormField label="Additional Observations / Notes">
          <textarea
            name="notes"
            rows={2}
            placeholder="Bench observations, voltage readings, or special procedures..."
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
            {isPending ? "Logging..." : "Record Action"}
          </Button>
        </div>
      </form>
    </div>
  );
}
