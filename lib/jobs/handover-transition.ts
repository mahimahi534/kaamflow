export type HandoverStatus = "handover" | "closed";
export type HandoverOverrideRequirement = "payment_override" | "qc_override";

export interface HandoverRpcArgs {
  target_job_id: string;
  target_status: HandoverStatus;
  payment_override_reason: string | null;
  qc_override_reason: string | null;
}

export interface HandoverRpcError {
  code: string | null;
  message: string;
}

export type HandoverTransitionResult =
  | { success: true }
  | {
      success: false;
      error: string;
      overrideRequired?: HandoverOverrideRequirement;
    };

export async function executeHandoverTransition({
  role,
  jobId,
  targetStatus,
  paymentOverrideReason,
  qcOverrideReason,
  rpc,
}: {
  role: string;
  jobId: string;
  targetStatus: HandoverStatus;
  paymentOverrideReason?: string;
  qcOverrideReason?: string;
  rpc: (args: HandoverRpcArgs) => Promise<{ error: HandoverRpcError | null }>;
}): Promise<HandoverTransitionResult> {
  const isOwner = role === "OWNER_ADMIN";
  const hasOverrideReason =
    paymentOverrideReason !== undefined || qcOverrideReason !== undefined;

  if (role !== "OWNER_ADMIN" && role !== "DISPATCHER") {
    return {
      success: false,
      error: "Only an Owner or Service Desk user can request handover.",
    };
  }

  if (hasOverrideReason && !isOwner) {
    return {
      success: false,
      error: "Only an Owner can submit a handover override reason.",
    };
  }

  const normalizedPaymentReason = paymentOverrideReason?.trim();
  const normalizedQcReason = qcOverrideReason?.trim();

  if (
    paymentOverrideReason !== undefined &&
    (!normalizedPaymentReason ||
      normalizedPaymentReason.length < 10 ||
      normalizedPaymentReason.length > 1000)
  ) {
    return {
      success: false,
      error: "Payment override reasons must be between 10 and 1000 characters.",
    };
  }

  if (
    qcOverrideReason !== undefined &&
    (!normalizedQcReason ||
      normalizedQcReason.length < 10 ||
      normalizedQcReason.length > 1000)
  ) {
    return {
      success: false,
      error: "QC override reasons must be between 10 and 1000 characters.",
    };
  }

  let result: { error: HandoverRpcError | null };
  try {
    result = await rpc({
      target_job_id: jobId,
      target_status: targetStatus,
      payment_override_reason: normalizedPaymentReason ?? null,
      qc_override_reason: normalizedQcReason ?? null,
    });
  } catch {
    return {
      success: false,
      error:
        "We could not confirm the handover update. Refresh the job before retrying; completed updates are safe to retry.",
    };
  }

  if (!result.error) {
    return { success: true };
  }

  const message = result.error.message;

  if (message.includes("waived invoice with an outstanding ledger balance")) {
    return {
      success: false,
      error:
        "This invoice is marked waived but still has an outstanding balance. Resolve the invoice balance before handover.",
    };
  }

  if (message.includes("Quality Control Required")) {
    return isOwner
      ? {
          success: false,
          error: "A passing QC inspection is required, or an Owner must document a QC exception.",
          overrideRequired: "qc_override",
        }
      : {
          success: false,
          error: "A passing QC inspection is required before handover. Ask an Owner to review an exception.",
        };
  }

  if (
    message.includes("An Owner override reason between") ||
    message.includes("Handover requires a recorded invoice balance override.")
  ) {
    return isOwner
      ? {
          success: false,
          error:
            "An invoice is missing or has an outstanding balance. An Owner may document a payment exception.",
          overrideRequired: "payment_override",
        }
      : {
          success: false,
          error:
            "An invoice is missing or has an outstanding balance. Settle it before handover or ask an Owner to review an exception.",
        };
  }

  if (result.error.code === "P0002" || message.includes("Repair job not found")) {
    return { success: false, error: "Repair job not found or no longer available." };
  }

  if (result.error.code === "42501") {
    return { success: false, error: "You are not authorized to perform this handover." };
  }

  return {
    success: false,
    error:
      "The handover could not be completed. Refresh the job and retry; if the problem continues, contact an Owner.",
  };
}
