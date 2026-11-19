"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/types/database";

export async function generateInvoiceFromJobAction(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_invoice_from_job", {
    target_job_id: jobId,
  });

  if (error) {
    console.error("Failed to generate invoice:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export async function recordManualPaymentAction(
  _prevState: { success: boolean; error?: string } | null,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const jobId = formData.get("job_id")?.toString().trim();
  const amountStr = formData.get("amount")?.toString().trim();
  const requestKey = formData.get("payment_request_key")?.toString().trim();
  const method = formData.get("payment_method")?.toString().trim() as PaymentMethod;
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!jobId) {
    return { success: false, error: "Job reference is missing." };
  }
  const isValidRequestKey =
    !!requestKey &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey);
  if (!isValidRequestKey) {
    return {
      success: false,
      error: "Payment request reference is missing or invalid. Please retry.",
    };
  }

  const amount = Number(amountStr || "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      error: "Enter a valid payment amount greater than zero.",
    };
  }

  const validMethods: PaymentMethod[] = ["cash", "card", "bank_transfer", "cheque", "mobile_pay", "other"];
  if (!validMethods.includes(method)) {
    return { success: false, error: "Invalid payment method selected." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_manual_invoice_payment", {
    target_job_id: jobId,
    payment_amount: amount,
    payment_method: method,
    target_request_key: requestKey,
    payment_notes: notes,
  });

  if (error) {
    console.error("Manual payment RPC failed:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}
