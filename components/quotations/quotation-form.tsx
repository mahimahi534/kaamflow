"use client";

import { useState, useActionState, useId } from "react";
import Link from "next/link";
import { createQuotationAction, type QuotationFormState } from "@/lib/actions/quotations";
import type { JobWithRelations, PartUsed, Diagnosis } from "@/lib/types/database";

interface QuotationFormProps {
  availableJobs: JobWithRelations[];
  selectedJobId?: string;
  initialJobDetails?: {
    parts_used?: PartUsed[];
    diagnoses?: Diagnosis[];
  } | null;
  versionNumber?: number;
  initialValues?: {
    labour_charge?: number;
    parts_cost?: number;
    notes?: string;
  };
}

export function QuotationForm({
  availableJobs,
  selectedJobId: initialSelectedJobId,
  initialJobDetails,
  versionNumber = 1,
  initialValues,
}: QuotationFormProps) {
  const formId = useId();
  const [selectedJobId, setSelectedJobId] = useState<string>(initialSelectedJobId || "");

  // Financial calculation state
  const [labourCharge, setLabourCharge] = useState<string>(
    initialValues?.labour_charge !== undefined ? initialValues.labour_charge.toString() : "0.00"
  );

  // If initial parts were passed, sum them up as a convenience default
  const defaultPartsTotal = initialJobDetails?.parts_used?.reduce(
    (sum, p) => sum + Number(p.quantity) * Number(p.unit_cost),
    0
  ) || 0;

  const [partsCost, setPartsCost] = useState<string>(
    initialValues?.parts_cost !== undefined
      ? initialValues.parts_cost.toString()
      : defaultPartsTotal > 0
        ? defaultPartsTotal.toFixed(2)
        : "0.00"
  );

  const [taxRate, setTaxRate] = useState<string>("10.0");
  const [discountAmount, setDiscountAmount] = useState<string>("0.00");
  const [notes, setNotes] = useState<string>(initialValues?.notes || "");
  const [submissionType, setSubmissionType] = useState<"draft" | "send">("draft");

  const [state, formAction, isPending] = useActionState<QuotationFormState, FormData>(
    createQuotationAction,
    { success: false }
  );

  // Live client-side financial calculations
  const parsedLabour = Math.max(0, parseFloat(labourCharge) || 0);
  const parsedParts = Math.max(0, parseFloat(partsCost) || 0);
  const parsedDiscount = Math.max(0, parseFloat(discountAmount) || 0);
  const parsedTaxRate = Math.max(0, parseFloat(taxRate) || 0);

  const subtotal = Math.max(0, parsedLabour + parsedParts - parsedDiscount);
  const calculatedTax = subtotal * (parsedTaxRate / 100);
  const grandTotal = subtotal + calculatedTax;

  const activeJob = availableJobs.find((j) => j.id === selectedJobId);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="submission_type" value={submissionType} />

      {state.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Unable to create quotation</p>
          <p>{state.error}</p>
        </div>
      )}

      {/* Top Section: Job & Customer Context */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Repair Job Association</h3>
            <p className="text-xs text-slate-500">
              Each quotation version must be strictly attached to an active repair job tenant record.
            </p>
          </div>
          <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            Version v{versionNumber}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-job_id`} className="block text-xs font-semibold text-slate-700 mb-1">
              Select Repair Job <span className="text-rose-500">*</span>
            </label>
            <select
              id={`${formId}-job_id`}
              name="job_id"
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- Choose a Repair Job --</option>
              {availableJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  Job #{job.id.slice(0, 8)} — {job.customer?.full_name || "Unknown Customer"} (
                  {job.asset ? `${job.asset.brand || ""} ${job.asset.model || ""}`.trim() : "No asset"})
                </option>
              ))}
            </select>
            {state.fieldErrors?.job_id && (
              <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.job_id}</p>
            )}
          </div>

          {activeJob && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">Job Details:</p>
              <p>
                <span className="text-slate-500">Customer:</span>{" "}
                <span className="font-medium text-slate-900">{activeJob.customer?.full_name || "N/A"}</span>{" "}
                {activeJob.customer?.phone && `(${activeJob.customer.phone})`}
              </p>
              <p>
                <span className="text-slate-500">Equipment:</span>{" "}
                <span className="font-medium text-slate-900">
                  {activeJob.asset ? `${activeJob.asset.brand || ""} ${activeJob.asset.model || ""} (${activeJob.asset.category})` : "N/A"}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Reported Issue:</span>{" "}
                <span className="italic">{activeJob.issue_summary}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Middle Section: Cost Builder (Labor, Parts, Tax, Discount) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="mb-4 text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
          Quotation Price Breakdown
        </h3>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* Labor Charge */}
          <div>
            <label htmlFor={`${formId}-labour`} className="block text-xs font-semibold text-slate-700 mb-1">
              Labor Charge ($) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">$</span>
              <input
                id={`${formId}-labour`}
                name="labour_charge"
                type="number"
                step="0.01"
                min="0"
                value={labourCharge}
                onChange={(e) => setLabourCharge(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {state.fieldErrors?.labour_charge && (
              <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.labour_charge}</p>
            )}
          </div>

          {/* Parts Cost */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`${formId}-parts`} className="block text-xs font-semibold text-slate-700">
                Parts & Materials ($) <span className="text-rose-500">*</span>
              </label>
              {defaultPartsTotal > 0 && (
                <button
                  type="button"
                  onClick={() => setPartsCost(defaultPartsTotal.toFixed(2))}
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                >
                  Use logged parts (${defaultPartsTotal.toFixed(2)})
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">$</span>
              <input
                id={`${formId}-parts`}
                name="parts_cost"
                type="number"
                step="0.01"
                min="0"
                value={partsCost}
                onChange={(e) => setPartsCost(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {state.fieldErrors?.parts_cost && (
              <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.parts_cost}</p>
            )}
          </div>

          {/* Discount */}
          <div>
            <label htmlFor={`${formId}-discount`} className="block text-xs font-semibold text-slate-700 mb-1">
              Discount Amount ($)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">$</span>
              <input
                id={`${formId}-discount`}
                name="discount_amount"
                type="number"
                step="0.01"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {state.fieldErrors?.discount_amount && (
              <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.discount_amount}</p>
            )}
          </div>

          {/* Tax Rate */}
          <div>
            <label htmlFor={`${formId}-tax`} className="block text-xs font-semibold text-slate-700 mb-1">
              Tax Rate (%)
            </label>
            <div className="relative">
              <input
                id={`${formId}-tax`}
                name="tax_rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-slate-400">%</span>
            </div>
            {state.fieldErrors?.tax_rate && (
              <p className="mt-1 text-xs text-rose-600">{state.fieldErrors.tax_rate}</p>
            )}
          </div>
        </div>

        {/* Real-time Calculation Summary Card */}
        <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="text-xs text-slate-600 space-y-1">
              <p>
                <span className="text-slate-500">Labor:</span> ${parsedLabour.toFixed(2)} +{" "}
                <span className="text-slate-500">Parts:</span> ${parsedParts.toFixed(2)}
                {parsedDiscount > 0 && ` - Discount: $${parsedDiscount.toFixed(2)}`}
              </p>
              <p>
                <span className="text-slate-500">Subtotal:</span>{" "}
                <span className="font-semibold text-slate-800">${subtotal.toFixed(2)}</span>
              </p>
              <p>
                <span className="text-slate-500">Estimated Tax ({parsedTaxRate}%):</span>{" "}
                <span className="font-semibold text-slate-800">${calculatedTax.toFixed(2)}</span>
              </p>
            </div>

            <div className="text-right sm:border-l sm:border-slate-200 sm:pl-6">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-500 block">
                Grand Total (Inc. Tax)
              </span>
              <span className="text-2xl font-bold text-slate-900">
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scope & Quotation Notes */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <label htmlFor={`${formId}-notes`} className="block text-xs font-semibold text-slate-700 mb-1">
          Repair Scope, Inclusions & Quotation Notes
        </label>
        <p className="text-xs text-slate-500 mb-2">
          Clearly describe the diagnostic findings, parts to be installed, warranties, and scope of work for the customer.
        </p>
        <textarea
          id={`${formId}-notes`}
          name="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Diagnostic confirmed failed blower motor and drive capacitor. Quote includes replacement OEM fan assembly, labor, and 90-day parts warranty."
          className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Action Footer */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <Link
          href="/quotations"
          className="inline-flex justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer text-center"
        >
          Cancel
        </Link>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            onClick={() => setSubmissionType("draft")}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            {isPending && submissionType === "draft" ? "Saving Draft..." : "Save as Draft"}
          </button>

          <button
            type="submit"
            disabled={isPending}
            onClick={() => setSubmissionType("send")}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 cursor-pointer disabled:opacity-50"
          >
            {isPending && submissionType === "send" ? "Sending..." : "Save & Send to Customer"}
          </button>
        </div>
      </div>
    </form>
  );
}
