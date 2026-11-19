"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { addPartUsedAction } from "@/lib/actions/jobs";

export function PartUsedForm({
  jobId,
  canEnterCost,
}: {
  jobId: string;
  canEnterCost: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrorMsg(null);

    startTransition(async () => {
      const res = await addPartUsedAction(jobId, formData);
      if (res.success) {
        setIsOpen(false);
      } else {
        setErrorMsg(res.error || "Failed to record part");
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
        + Record Part Used
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Record Part / Material</h4>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Part Name / Component *">
            <input
              type="text"
              name="partName"
              required
              placeholder="e.g. Drain pump motor assembly"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500"
            />
          </FormField>

          <FormField label="Part Number / SKU">
            <input
              type="text"
              name="partNumber"
              placeholder="e.g. OEM-4681EA2001T"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 font-mono"
            />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Quantity *">
            <input
              type="number"
              name="quantity"
              required
              min="1"
              defaultValue="1"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500"
            />
          </FormField>

          {canEnterCost && (
            <FormField label="Unit Cost ($) *">
              <input
                type="number"
                name="unitCost"
                required
                step="0.01"
                min="0"
                defaultValue="0.00"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 font-mono"
              />
            </FormField>
          )}
        </div>

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
            {isPending ? "Adding..." : "Add Part"}
          </Button>
        </div>
      </form>
    </div>
  );
}
