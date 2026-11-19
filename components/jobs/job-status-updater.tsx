"use client";

import { useRef, useState, useTransition } from "react";
import { updateJobStatusAction } from "@/lib/actions/jobs";
import type {
  JobStatusActionResult,
  JobStatusOverrideOptions,
} from "@/lib/actions/jobs";
import type { JobStatus } from "@/lib/types/database";

const STATUS_OPTIONS: { label: string; value: JobStatus }[] = [
  { label: "Intake", value: "intake" },
  { label: "In Diagnosis", value: "diagnosis" },
  { label: "Quotation Needed", value: "quotation" },
  { label: "Awaiting Customer Approval", value: "awaiting_customer_approval" },
  { label: "Assigned to Technician", value: "assigned" },
  { label: "In Progress (Active Repair)", value: "in_progress" },
  { label: "Waiting for Parts", value: "waiting_for_parts" },
  { label: "Submitted for QC Review", value: "qc_review" },
  { label: "Repair Completed", value: "completed" },
  { label: "Ready for Handover", value: "handover" },
  { label: "Closed / Handed Over", value: "closed" },
];

type OverrideField = keyof JobStatusOverrideOptions;

const OVERRIDE_FIELD_BY_REQUIREMENT = {
  quote_waiver: "quoteWaiverReason",
  qc_override: "qcOverrideReason",
  payment_override: "paymentOverrideReason",
} as const;

const OVERRIDE_FIELD_DETAILS: Record<
  OverrideField,
  { label: string; placeholder: string }
> = {
  quoteWaiverReason: {
    label: "Quotation waiver reason",
    placeholder: "Explain why work is proceeding without quotation approval.",
  },
  qcOverrideReason: {
    label: "Quality-control exception reason",
    placeholder: "Explain why the Owner is authorizing an exception to QC.",
  },
  paymentOverrideReason: {
    label: "Payment exception reason",
    placeholder: "Explain why handover is approved without a settled invoice.",
  },
};

const EMPTY_REASONS: Record<OverrideField, string> = {
  quoteWaiverReason: "",
  qcOverrideReason: "",
  paymentOverrideReason: "",
};

function getOverrideDescription(fields: OverrideField[]): string {
  if (fields.includes("quoteWaiverReason")) {
    return "Starting chargeable repair work without customer quotation approval requires a documented Owner waiver.";
  }

  if (
    fields.includes("qcOverrideReason") &&
    fields.includes("paymentOverrideReason")
  ) {
    return "This handover requires separate Owner reasons for the QC exception and the missing or outstanding invoice balance.";
  }

  if (fields.includes("qcOverrideReason")) {
    return "Handover requires a passing QC inspection unless an Owner records a reasoned exception.";
  }

  return "Handover requires a settled invoice. If an invoice is missing or has an outstanding balance, only an Owner may record a reasoned exception. A waived invoice with a positive balance cannot be overridden.";
}

function getOverrideTitle(fields: OverrideField[]): string {
  if (fields.includes("quoteWaiverReason")) return "Quotation Waiver";
  if (
    fields.includes("qcOverrideReason") &&
    fields.includes("paymentOverrideReason")
  ) {
    return "Handover Exceptions";
  }
  if (fields.includes("qcOverrideReason")) return "QC Handover Exception";
  return "Payment Handover Exception";
}

function getOverrideOptions(
  fields: OverrideField[],
  reasons: Record<OverrideField, string>
): JobStatusOverrideOptions {
  return {
    ...(fields.includes("quoteWaiverReason")
      ? { quoteWaiverReason: reasons.quoteWaiverReason.trim() }
      : {}),
    ...(fields.includes("qcOverrideReason")
      ? { qcOverrideReason: reasons.qcOverrideReason.trim() }
      : {}),
    ...(fields.includes("paymentOverrideReason")
      ? { paymentOverrideReason: reasons.paymentOverrideReason.trim() }
      : {}),
  };
}

export function JobStatusUpdater({
  jobId,
  currentStatus,
  userRole = "STAFF",
}: {
  jobId: string;
  currentStatus: JobStatus;
  userRole?: string;
}) {
  const [selectedStatus, setSelectedStatus] = useState<JobStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [overrideModal, setOverrideModal] = useState<{
    targetStatus: JobStatus;
    fields: OverrideField[];
  } | null>(null);
  const [overrideReasons, setOverrideReasons] =
    useState<Record<OverrideField, string>>(EMPTY_REASONS);
  const requestInFlight = useRef(false);

  function submitStatusChange(
    targetStatus: JobStatus,
    overrideOptions?: JobStatusOverrideOptions
  ) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;

    startTransition(async () => {
      try {
        const result: JobStatusActionResult = await updateJobStatusAction(
          jobId,
          targetStatus,
          overrideOptions
        );

        if (result.success) {
          setSelectedStatus(targetStatus);
          setOverrideModal(null);
          setOverrideReasons(EMPTY_REASONS);
          setErrorMsg(null);
          return;
        }

        setSelectedStatus(currentStatus);
        const requiredField = result.overrideRequired
          ? OVERRIDE_FIELD_BY_REQUIREMENT[result.overrideRequired]
          : null;

        if (userRole === "OWNER_ADMIN" && requiredField) {
          setOverrideModal((previous) => {
            const existingFields =
              previous?.targetStatus === targetStatus ? previous.fields : [];
            return {
              targetStatus,
              fields: Array.from(new Set([...existingFields, requiredField])),
            };
          });
          setErrorMsg(null);
          return;
        }

        setErrorMsg(result.error || "The job status could not be updated.");
      } catch {
        setSelectedStatus(currentStatus);
        setErrorMsg(
          "We could not confirm the status update. Refresh the job before retrying; completed updates are safe to retry."
        );
      } finally {
        requestInFlight.current = false;
      }
    });
  }

  function handleStatusChange(newStatus: JobStatus) {
    if (requestInFlight.current) return;
    setSelectedStatus(newStatus);
    setErrorMsg(null);
    setOverrideModal(null);
    setOverrideReasons(EMPTY_REASONS);
    submitStatusChange(newStatus);
  }

  function handleConfirmOverride() {
    if (!overrideModal || requestInFlight.current) return;

    const hasInvalidReason = overrideModal.fields.some((field) => {
      const length = overrideReasons[field].trim().length;
      return length < 10 || length > 1000;
    });

    if (hasInvalidReason) {
      setErrorMsg("Each required reason must be between 10 and 1000 characters.");
      return;
    }

    setErrorMsg(null);
    submitStatusChange(
      overrideModal.targetStatus,
      getOverrideOptions(overrideModal.fields, overrideReasons)
    );
  }

  function cancelOverride() {
    if (isPending) return;
    setOverrideModal(null);
    setOverrideReasons(EMPTY_REASONS);
    setSelectedStatus(currentStatus);
    setErrorMsg(null);
  }

  const canConfirmOverride =
    overrideModal?.fields.every((field) => {
      const length = overrideReasons[field].trim().length;
      return length >= 10 && length <= 1000;
    }) ?? false;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={selectedStatus}
          disabled={isPending || Boolean(overrideModal)}
          onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {isPending && (
          <span className="flex items-center text-xs font-medium text-blue-600">
            <svg
              className="mr-1 h-3.5 w-3.5 animate-spin text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Updating...
          </span>
        )}
      </div>

      {errorMsg && !overrideModal && (
        <div
          className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800"
          role="alert"
        >
          <p className="font-semibold">{errorMsg}</p>
        </div>
      )}

      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-override-title"
          >
            <div>
              <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                Owner Exception Authorization
              </span>
              <h3
                id="job-override-title"
                className="mt-2 text-base font-bold text-slate-900"
              >
                {getOverrideTitle(overrideModal.fields)}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {getOverrideDescription(overrideModal.fields)}
              </p>
            </div>

            {overrideModal.fields.map((field) => {
              const details = OVERRIDE_FIELD_DETAILS[field];
              return (
                <div key={field} className="space-y-1.5">
                  <label
                    htmlFor={`job-override-${field}`}
                    className="text-xs font-semibold text-slate-700"
                  >
                    {details.label} *
                  </label>
                  <textarea
                    id={`job-override-${field}`}
                    rows={3}
                    required
                    minLength={10}
                    maxLength={1000}
                    disabled={isPending}
                    value={overrideReasons[field]}
                    onChange={(event) =>
                      setOverrideReasons((previous) => ({
                        ...previous,
                        [field]: event.target.value,
                      }))
                    }
                    placeholder={details.placeholder}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                  />
                </div>
              );
            })}

            {errorMsg && (
              <p className="text-xs font-semibold text-rose-700" role="alert">
                {errorMsg}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isPending}
                onClick={cancelOverride}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canConfirmOverride || isPending}
                onClick={handleConfirmOverride}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending ? "Recording exception..." : "Authorize & Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
