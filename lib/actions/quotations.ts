"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireAuth } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { QuoteVersion } from "@/lib/types/database";

export interface QuotationFormState {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  quoteVersion?: QuoteVersion;
}

/**
 * Server Action: Create a new Quotation Version from an existing repair job.
 * Validates prices, computes taxes and totals strictly on the server.
 * Enforces business_id from the authenticated staff session.
 */
export async function createQuotationAction(
  _prevState: QuotationFormState,
  formData: FormData
): Promise<QuotationFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  const jobId = (formData.get("job_id") as string | null)?.trim() || "";
  const labourChargeStr = (formData.get("labour_charge") as string | null)?.trim() || "0";
  const partsCostStr = (formData.get("parts_cost") as string | null)?.trim() || "0";
  const taxRateStr = (formData.get("tax_rate") as string | null)?.trim() || "0";
  const discountStr = (formData.get("discount_amount") as string | null)?.trim() || "0";
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const submissionType = (formData.get("submission_type") as string | null)?.trim() || "draft";

  const fieldErrors: Record<string, string> = {};

  if (!jobId) {
    fieldErrors.job_id = "A valid repair job is required.";
  }
  if (submissionType !== "draft" && submissionType !== "send") {
    fieldErrors.submission_type = "Select whether to save a draft or send the quotation.";
  }

  const labour = parseFloat(labourChargeStr);
  if (isNaN(labour) || labour < 0) {
    fieldErrors.labour_charge = "Labor charge must be a valid non-negative number.";
  }

  const parts = parseFloat(partsCostStr);
  if (isNaN(parts) || parts < 0) {
    fieldErrors.parts_cost = "Parts cost must be a valid non-negative number.";
  }

  const taxRate = parseFloat(taxRateStr);
  if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
    fieldErrors.tax_rate = "Tax rate must be between 0% and 100%.";
  }

  const discount = parseFloat(discountStr);
  if (isNaN(discount) || discount < 0) {
    fieldErrors.discount_amount = "Discount must be a valid non-negative number.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  const supabase = await createClient();

  // 1. Verify job exists and belongs to current tenant
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, business_id, customer_id, status")
    .eq("id", jobId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (jobErr || !job) {
    return {
      success: false,
      error: "Repair job was not found or does not belong to your business.",
    };
  }

  // 2. Strict server-side financial calculations with 2-decimal precision
  const safeLabour = Math.round(labour * 100) / 100;
  const safeParts = Math.round(parts * 100) / 100;
  const safeDiscount = Math.round(discount * 100) / 100;

  const subtotalBeforeTax = Math.max(0, Math.round((safeLabour + safeParts - safeDiscount) * 100) / 100);
  const safeTaxAmount = Math.round((subtotalBeforeTax * (taxRate / 100)) * 100) / 100;
  const safeTotalAmount = Math.round((subtotalBeforeTax + safeTaxAmount) * 100) / 100;

  // 3. Determine next version number for this job
  const { data: existingVersions, error: vErr } = await supabase
    .from("quote_versions")
    .select("version_number")
    .eq("job_id", jobId)
    .order("version_number", { ascending: false })
    .limit(1);

  if (vErr) {
    console.error("Error looking up existing quote versions:", vErr);
  }

  const nextVersionNumber = existingVersions && existingVersions.length > 0
    ? existingVersions[0].version_number + 1
    : 1;

  // Build notes with discount/tax breakdown if discount was applied
  let finalNotes = notes || "";
  if (safeDiscount > 0) {
    const discountBreakdown = `[Discount applied: $${safeDiscount.toFixed(2)} | Tax rate: ${taxRate}%]`;
    finalNotes = finalNotes ? `${finalNotes}\n${discountBreakdown}` : discountBreakdown;
  }

  // 4. Insert into quote_versions
  const { data: newVersion, error: insertErr } = await supabase
    .from("quote_versions")
    .insert({
      business_id: businessId,
      job_id: jobId,
      version_number: nextVersionNumber,
      labour_charge: safeLabour,
      parts_cost: safeParts,
      tax_amount: safeTaxAmount,
      total_amount: safeTotalAmount,
      notes: finalNotes || null,
      status: "draft",
    })
    .select()
    .single();

  if (insertErr || !newVersion) {
    console.error("Failed to insert quote_version:", insertErr);
    return {
      success: false,
      error: insertErr?.message || "Failed to create quotation in database.",
    };
  }

  // Sending the quotation and moving the job into the approval state are atomic.
  if (submissionType === "send") {
    const { error: sendError } = await supabase.rpc("send_quote_version", {
      target_quote_version_id: newVersion.id,
    });

    if (sendError) {
      console.error("Failed to send quotation:", sendError);
      return {
        success: false,
        error: `Quotation was saved as a draft but could not be sent: ${sendError.message}`,
      };
    }
  } else {
    // If saving as draft, update job status to quotation if it's in early intake/diagnosis
    if (["new_request", "intake", "diagnosis"].includes(job.status)) {
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ status: "quotation" })
        .eq("id", jobId)
        .eq("business_id", businessId);

      if (jobUpdateError) {
        console.error("Could not move job into quotation status:", jobUpdateError);
        return {
          success: false,
          error: `Quotation was saved, but the job status could not be updated: ${jobUpdateError.message}`,
        };
      }
    }
  }

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${newVersion.id}`);
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);

  redirect(`/quotations/${newVersion.id}`);
}

/**
 * Server Action: Send an existing draft quotation to the customer.
 * Creates delivery record in quotes table and transitions job to awaiting_customer_approval.
 */
export async function sendQuotationAction(quoteVersionId: string): Promise<{ success: boolean; error?: string }> {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"]);

  const supabase = await createClient();

  const { error } = await supabase.rpc("send_quote_version", {
    target_quote_version_id: quoteVersionId,
  });

  if (error) {
    console.error("send_quote_version RPC failed:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quoteVersionId}`);
  revalidatePath("/jobs");

  return { success: true };
}

/**
 * Server Action: For authenticated CUSTOMER responding to a sent quotation.
 * Uses the database security-definer RPC `public.respond_to_quote`.
 */
export async function respondToQuoteCustomerAction(
  _prevState: { success: boolean; error?: string },
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAuth();
  if (session.profile.role !== "CUSTOMER") {
    return { success: false, error: "Only verified customer accounts can submit customer approvals." };
  }

  const quoteVersionId = (formData.get("quote_version_id") as string | null)?.trim() || "";
  const decision = (formData.get("decision") as string | null)?.trim() || "";
  const comments = (formData.get("comments") as string | null)?.trim() || "";

  if (!quoteVersionId) {
    return { success: false, error: "Quotation reference is missing." };
  }

  if (decision !== "approved" && decision !== "declined") {
    return { success: false, error: "Decision must be either 'approved' or 'declined'." };
  }

  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("respond_to_quote", {
    target_quote_version_id: quoteVersionId,
    decision,
    customer_comments: comments || null,
  });

  if (rpcErr) {
    console.error("respond_to_quote RPC failed:", rpcErr);
    return {
      success: false,
      error: rpcErr.message || "Failed to submit quotation response. Please contact the workshop.",
    };
  }

  revalidatePath("/portal/quotes");
  revalidatePath(`/portal/quotes/${quoteVersionId}`);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quoteVersionId}`);
  revalidatePath("/jobs");

  return { success: true };
}

/**
 * Server Action: Staff recording customer's verbal / offline approval or rejection.
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function recordStaffApprovalAction(
  _prevState: { success: boolean; error?: string },
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);

  const quoteVersionId = (formData.get("quote_version_id") as string | null)?.trim() || "";
  const decision = (formData.get("decision") as string | null)?.trim() || "";
  const comments = (formData.get("comments") as string | null)?.trim() || "";

  if (!quoteVersionId) {
    return { success: false, error: "Quotation version ID is required." };
  }

  if (decision !== "approved" && decision !== "declined") {
    return { success: false, error: "Decision must be approved or declined." };
  }
  if (comments.length > 1800) {
    return { success: false, error: "Comments must be 1800 characters or fewer." };
  }

  const supabase = await createClient();

  const noteWithStaff = `[Staff recorded via ${session.profile.full_name}]: ${comments}`.trim();
  const { error } = await supabase.rpc("record_staff_quote_decision", {
    target_quote_version_id: quoteVersionId,
    decision,
    staff_comments: noteWithStaff || null,
  });

  if (error) {
    console.error("record_staff_quote_decision RPC failed:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quoteVersionId}`);
  revalidatePath("/jobs");

  return { success: true };
}
