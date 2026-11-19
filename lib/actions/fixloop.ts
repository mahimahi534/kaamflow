"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { StaffReportedOutcome } from "@/lib/types/database";

export async function scheduleFollowUpAction(
  jobId: string,
  daysAhead: number = 3
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 90) {
    return { success: false, error: "Follow-up scheduling must be between 0 and 90 days." };
  }

  const supabase = await createClient();

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + daysAhead);

  const deadline = new Date(dueAt);
  deadline.setDate(deadline.getDate() + 7);

  const { error } = await supabase.from("follow_ups").insert({
    business_id: businessId,
    job_id: jobId,
    due_at: dueAt.toISOString(),
    response_deadline: deadline.toISOString(),
    status: "scheduled",
  });

  if (error) {
    console.error("Failed to schedule follow-up:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/fixloop");
  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export async function recordStaffFollowUpOutcomeAction(
  _prevState: { success: boolean; error?: string } | null,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const followUpId = formData.get("follow_up_id")?.toString().trim();
  const outcomeRaw = formData.get("outcome")?.toString().trim() as StaffReportedOutcome;
  const notes = formData.get("notes")?.toString().trim() || null;
  const privacyConsent = formData.get("privacy_consent") === "true";

  if (!followUpId) {
    return { success: false, error: "Follow-up reference is required." };
  }

  const validOutcomes: StaffReportedOutcome[] = [
    "working",
    "same_symptom",
    "partly",
    "different_issue",
    "no_response",
  ];

  if (!validOutcomes.includes(outcomeRaw)) {
    return { success: false, error: "Invalid outcome category selected." };
  }
  if (notes && notes.length > 4000) {
    return { success: false, error: "Follow-up notes must be 4000 characters or fewer." };
  }
  if (outcomeRaw === "different_issue" && (!notes || !privacyConsent)) {
    return {
      success: false,
      error: "A new issue description and explicit privacy consent are required.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_staff_follow_up_outcome", {
    target_follow_up_id: followUpId,
    outcome_key: outcomeRaw,
    staff_notes: notes,
    has_privacy_consent: privacyConsent,
  });

  if (error) {
    console.error("Follow-up outcome RPC failed:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/fixloop");
  revalidatePath("/analytics");
  revalidatePath("/jobs");

  return { success: true };
}
