"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireAuth } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { executeHandoverTransition } from "@/lib/jobs/handover-transition";
import type { Job, JobStatus } from "@/lib/types/database";

export interface JobFormState {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  job?: Job;
}

const VALID_STATUSES: JobStatus[] = [
  "new_request",
  "intake",
  "diagnosis",
  "quotation",
  "awaiting_customer_approval",
  "assigned",
  "in_progress",
  "waiting_for_parts",
  "qc_review",
  "completed",
  "handover",
  "closed",
];
const INITIAL_STATUSES: JobStatus[] = ["intake", "diagnosis"];

export type JobStatusOverrideRequirement =
  | "quote_waiver"
  | "qc_override"
  | "payment_override";

export type JobStatusActionResult =
  | { success: true }
  | {
      success: false;
      error: string;
      overrideRequired?: JobStatusOverrideRequirement;
    };

export interface JobStatusOverrideOptions {
  quoteWaiverReason?: string;
  qcOverrideReason?: string;
  paymentOverrideReason?: string;
}

/**
 * Server Action: Create a new Repair Job.
 * Role required: OWNER_ADMIN or DISPATCHER.
 * Enforces business_id from server session.
 */
export async function createJobAction(
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found." };
  }

  const customerId = formData.get("customerId")?.toString().trim() || null;
  const assetId = formData.get("assetId")?.toString().trim() || null;
  const serviceRequestId = formData.get("serviceRequestId")?.toString().trim() || null;
  const issueSummary = formData.get("issueSummary")?.toString().trim();
  const diagnosisNotes = formData.get("diagnosisNotes")?.toString().trim() || null;
  const statusRaw = (formData.get("status")?.toString().trim() || "intake") as JobStatus;

  const fieldErrors: Record<string, string> = {};
  if (!issueSummary) {
    fieldErrors.issueSummary = "Issue summary is required.";
  }
  if (!INITIAL_STATUSES.includes(statusRaw)) {
    fieldErrors.status = "New repair jobs must start in intake or diagnosis.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      business_id: businessId,
      customer_id: customerId,
      asset_id: assetId,
      service_request_id: serviceRequestId,
      issue_summary: issueSummary!,
      diagnosis_notes: diagnosisNotes,
      status: statusRaw,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating job:", error);
    return { success: false, error: `Failed to create repair job: ${error.message}` };
  }

  revalidatePath("/jobs");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  if (assetId) revalidatePath(`/equipment/${assetId}`);
  if (serviceRequestId) revalidatePath(`/requests/${serviceRequestId}`);

  redirect(`/jobs/${data.id}`);
}

/**
 * Server Action: 1-Click Promote Service Request to Repair Job.
 * Links customer, asset, and request reference automatically.
 */
export async function convertServiceRequestToJobAction(
  serviceRequestId: string
): Promise<void> {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const supabase = await createClient();
  const { data: jobId, error } = await supabase.rpc("convert_service_request_to_job", {
    target_service_request_id: serviceRequestId,
  });

  if (error || !jobId) {
    console.error("Error converting request to job:", error);
    throw new Error(`Failed to create job: ${error?.message || "No job was returned."}`);
  }

  revalidatePath("/jobs");
  revalidatePath("/requests");
  revalidatePath(`/requests/${serviceRequestId}`);
  redirect(`/jobs/${jobId}`);
}

/**
 * Server Action: Update Repair Job status.
 * Allowed for OWNER_ADMIN, DISPATCHER, or assigned TECHNICIAN.
 * Enforces business rules:
 * - in_progress requires quotation approval or OWNER_ADMIN waiver with audit reason.
 * - completed requires passing QC or an Owner QC override with an audit reason.
 * - handover / closed are validated and updated by the database transition RPC.
 */
export async function updateJobStatusAction(
  jobId: string,
  newStatus: JobStatus,
  overrideOptions?: JobStatusOverrideOptions
): Promise<JobStatusActionResult> {
  const session = await requireAuth();
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const isOwner = session.profile.role === "OWNER_ADMIN";
  const isDispatcher = session.profile.role === "DISPATCHER";
  const isTechnician = session.profile.role === "TECHNICIAN";
  if (!isOwner && !isDispatcher && !isTechnician) {
    return { success: false, error: "You are not allowed to change repair job status." };
  }

  if (!VALID_STATUSES.includes(newStatus)) {
    return { success: false, error: "Invalid status value." };
  }

  const hasOverrideReason = Object.values(overrideOptions ?? {}).some(
    (reason) => reason !== undefined
  );
  if (hasOverrideReason && !isOwner) {
    return {
      success: false,
      error: "Only an Owner can submit a job status override reason.",
    };
  }

  const overrideReasons = [
    ["Quotation waiver", overrideOptions?.quoteWaiverReason],
    ["QC override", overrideOptions?.qcOverrideReason],
    ["Payment override", overrideOptions?.paymentOverrideReason],
  ] as const;
  for (const [label, reason] of overrideReasons) {
    if (
      reason !== undefined &&
      (reason.trim().length < 10 || reason.trim().length > 1000)
    ) {
      return {
        success: false,
        error: `${label} reasons must be between 10 and 1000 characters.`,
      };
    }
  }

  if (
    overrideOptions?.quoteWaiverReason !== undefined &&
    newStatus !== "in_progress"
  ) {
    return { success: false, error: "Quotation waivers only apply when starting work." };
  }

  if (
    overrideOptions?.qcOverrideReason !== undefined &&
    !["completed", "handover", "closed"].includes(newStatus)
  ) {
    return { success: false, error: "QC overrides only apply to completion or handover." };
  }

  if (
    overrideOptions?.paymentOverrideReason !== undefined &&
    newStatus !== "handover" &&
    newStatus !== "closed"
  ) {
    return { success: false, error: "Payment overrides only apply to handover." };
  }

  const technicianStatuses: JobStatus[] = [
    "diagnosis",
    "in_progress",
    "waiting_for_parts",
    "qc_review",
  ];
  if (isTechnician && !technicianStatuses.includes(newStatus)) {
    return { success: false, error: "Technicians can only update the status of assigned work." };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    console.error("Could not initialize Supabase client for job status update.");
    return {
      success: false,
      error: "The job service is unavailable. Try again shortly.",
    };
  }

  if (newStatus === "handover" || newStatus === "closed") {
    const result = await executeHandoverTransition({
      role: session.profile.role,
      jobId,
      targetStatus: newStatus,
      paymentOverrideReason: overrideOptions?.paymentOverrideReason,
      qcOverrideReason: overrideOptions?.qcOverrideReason,
      rpc: async (args) => {
        const { error } = await supabase.rpc("transition_job_to_handover", args);
        return { error };
      },
    });

    if (!result.success) {
      return result;
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/technician");
    revalidatePath("/quality-control");
    revalidatePath("/fixloop");
    return { success: true };
  }

  // 1. Fetch current job state
  const { data: currentJob, error: fetchErr } = await supabase
    .from("jobs")
    .select("id, status, quote_required, quote_waiver_reason, qc_override_reason")
    .eq("id", jobId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (fetchErr) {
    console.error("Could not load job status context:", { code: fetchErr.code });
    return {
      success: false,
      error: "Could not load the current job status. Refresh the page and try again.",
    };
  }

  if (!currentJob) {
    return { success: false, error: "Repair job not found or no longer available." };
  }

  if (isTechnician) {
    const { data: assignment, error: assignmentError } = await supabase
      .from("assignments")
      .select("id")
      .eq("business_id", businessId)
      .eq("job_id", jobId)
      .eq("technician_id", session.profile.id)
      .in("status", ["assigned", "in_progress"])
      .maybeSingle();

    if (assignmentError) {
      console.error("Could not verify technician assignment:", {
        code: assignmentError.code,
      });
      return {
        success: false,
        error: "Could not verify your job assignment. Refresh the page and try again.",
      };
    }

    if (!assignment) {
      return { success: false, error: "You can only update work assigned to you." };
    }
  }

  if (currentJob.status === newStatus) {
    return { success: true };
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // 2. Business Rule: in_progress requires approved quotation
  if (newStatus === "in_progress") {
    const { data: latestQuote, error: quoteError } = await supabase
      .from("quote_versions")
      .select("id, status")
      .eq("business_id", businessId)
      .eq("job_id", jobId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (quoteError) {
      console.error("Could not verify quotation approval:", { code: quoteError.code });
      return {
        success: false,
        error: "Could not verify quotation approval. Refresh the page and try again.",
      };
    }

    const isQuoteApproved = latestQuote?.status === "approved";

    if (!isQuoteApproved && currentJob.quote_required !== false) {
      const quoteWaiverReason = overrideOptions?.quoteWaiverReason?.trim();
      const isOwnerWaiver =
        isOwner &&
        Boolean(quoteWaiverReason) &&
        currentJob.quote_waiver_reason !== quoteWaiverReason;

      if (!isOwnerWaiver) {
        return {
          success: false,
          error:
            "Quotation Approval Required: Chargeable repair work cannot begin until the customer approves the quotation. To proceed without approval, an Owner/Admin waiver with a documented reason is required.",
          overrideRequired: "quote_waiver",
        };
      }

      updateData.quote_waiver_reason = quoteWaiverReason;
      updateData.quote_waiver_by = session.profile.id;
    }
  }

  // 3. Business Rule: completion requires passing Quality Control
  if (newStatus === "completed") {
    const { data: latestQc, error: qcError } = await supabase
      .from("qc_records")
      .select("id, passed, created_at")
      .eq("business_id", businessId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qcError) {
      console.error("Could not verify the latest QC result:", { code: qcError.code });
      return {
        success: false,
        error: "Could not verify the latest QC result. Refresh the page and try again.",
      };
    }

    const hasPassedQc = latestQc?.passed === true;

    if (!hasPassedQc) {
      const isOwnerOverride =
        isOwner &&
        Boolean(overrideOptions?.qcOverrideReason?.trim()) &&
        currentJob.qc_override_reason !== overrideOptions?.qcOverrideReason?.trim();

      if (!isOwnerOverride) {
        return {
          success: false,
          error:
            "Quality Control Required: A passing QC inspection is required before a repair can be marked completed. Submit a review on the Quality Control board or apply an Owner exception.",
          overrideRequired: "qc_override",
        };
      }

      updateData.qc_override_reason = overrideOptions?.qcOverrideReason?.trim();
      updateData.qc_override_by = session.profile.id;
    }

    updateData.handed_over_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("jobs")
    .update(updateData)
    .eq("id", jobId)
    .eq("business_id", businessId);

  if (error) {
    console.error("Error updating job status:", { code: error.code });
    return {
      success: false,
      error: error.message.includes("Quotation Approval Required")
        ? "Customer quotation approval is required before work can start."
        : error.message.includes("Quality Control Required")
          ? "A passing QC inspection is required before completion."
          : "Could not update the job status. Refresh the page and try again.",
    };
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/technician");
  revalidatePath("/quality-control");
  revalidatePath("/fixloop");
  return { success: true };
}

/**
 * Server Action: Assign a Technician to a Job.
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function assignTechnicianAction(
  jobId: string,
  technicianId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_job_to_technician", {
    target_job_id: jobId,
    target_technician_id: technicianId,
  });

  if (error) {
    console.error("Error assigning technician:", error);
    return { success: false, error: `Failed to assign technician: ${error.message}` };
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/technicians");
  revalidatePath("/technician");
  return { success: true };
}

/**
 * Server Action: Record Diagnosis findings and root cause.
 */
export async function addDiagnosisAction(
  jobId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  await requireAuth();

  const notes = formData.get("notes")?.toString().trim();
  const rootCause = formData.get("rootCause")?.toString().trim() || null;

  if (!notes) {
    return { success: false, error: "Diagnosis notes are required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("record_job_diagnosis", {
    target_job_id: jobId,
    diagnosis_notes: notes,
    diagnosis_root_cause: rootCause,
  });

  if (error) {
    console.error("Error recording diagnosis:", error);
    return { success: false, error: `Failed to record diagnosis: ${error.message}` };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/technician");
  return { success: true };
}

/**
 * Server Action: Add a Repair Action Log entry.
 */
export async function addRepairLogAction(
  jobId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAuth();
  const businessId = session.profile.business_id;

  const action = formData.get("action")?.toString().trim();
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!action) {
    return { success: false, error: "Action description is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("repair_logs").insert({
    business_id: businessId,
    job_id: jobId,
    technician_id: session.user.id,
    action,
    notes,
  });

  if (error) {
    console.error("Error adding repair log:", error);
    return { success: false, error: `Failed to log repair action: ${error.message}` };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/technician");
  return { success: true };
}

/**
 * Server Action: Record Parts Used in a Repair Job.
 */
export async function addPartUsedAction(
  jobId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAuth();
  const businessId = session.profile.business_id;
  const canRecordParts =
    session.profile.role === "OWNER_ADMIN" ||
    session.profile.role === "DISPATCHER" ||
    session.profile.role === "TECHNICIAN";

  if (!canRecordParts) {
    return { success: false, error: "You are not allowed to record parts for repair jobs." };
  }

  const partName = formData.get("partName")?.toString().trim();
  const partNumber = formData.get("partNumber")?.toString().trim() || null;
  const quantity = parseInt(formData.get("quantity")?.toString() || "1", 10);
  const submittedUnitCost = parseFloat(formData.get("unitCost")?.toString() || "0");
  const unitCost = session.profile.role === "TECHNICIAN" ? 0 : submittedUnitCost;

  if (!partName) {
    return { success: false, error: "Part name is required." };
  }
  if (isNaN(quantity) || quantity <= 0) {
    return { success: false, error: "Quantity must be at least 1." };
  }
  if (isNaN(unitCost) || unitCost < 0) {
    return { success: false, error: "Unit cost cannot be negative." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("parts_used").insert({
    business_id: businessId,
    job_id: jobId,
    part_name: partName,
    part_number: partNumber,
    quantity,
    unit_cost: unitCost,
  });

  if (error) {
    console.error("Error logging part used:", error);
    return { success: false, error: `Failed to record part: ${error.message}` };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/technician");
  return { success: true };
}

/**
 * Server Action: Record a Parts Order (waiting-for-parts tracking).
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function recordPartsOrderAction(params: {
  jobId: string;
  partName: string;
  supplier?: string;
  arrivalDate?: string;
  customerVisibleNote?: string;
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  if (!params.partName.trim()) {
    return { success: false, error: "Part description is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_parts_order", {
    target_job_id: params.jobId,
    ordered_part_name: params.partName.trim(),
    ordered_supplier: params.supplier?.trim() || null,
    expected_date: params.arrivalDate || null,
    visible_note: params.customerVisibleNote?.trim() || null,
  });

  if (error) {
    console.error("Error recording parts order:", error);
    return { success: false, error: `Failed to record parts order: ${error.message}` };
  }

  revalidatePath(`/jobs/${params.jobId}`);
  revalidatePath("/jobs");
  return { success: true };
}

/**
 * Server Action: Log a formal customer complaint/dispute.
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function logComplaintAction(params: {
  jobId: string;
  customerId?: string;
  complaintText: string;
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  if (!params.complaintText.trim()) {
    return { success: false, error: "Complaint description is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("complaints").insert({
    business_id: businessId,
    job_id: params.jobId,
    customer_id: params.customerId || null,
    complaint_text: params.complaintText.trim(),
    status: "open",
  });

  if (error) {
    console.error("Error logging complaint:", error);
    return { success: false, error: `Failed to log complaint: ${error.message}` };
  }

  revalidatePath(`/jobs/${params.jobId}`);
  return { success: true };
}
