"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function submitQcInspectionAction(
  _prevState: { success: boolean; error?: string } | null,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER", "QC_REVIEWER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const jobId = formData.get("job_id")?.toString().trim();
  const passedStr = formData.get("passed")?.toString().trim();
  const comments = formData.get("comments")?.toString().trim() || null;
  const checklistRaw = formData.get("checklist")?.toString().trim();

  if (!jobId) {
    return { success: false, error: "Repair job reference is required." };
  }

  if (passedStr !== "true" && passedStr !== "false") {
    return { success: false, error: "Select either pass or fail for this inspection." };
  }

  if (comments && comments.length > 4000) {
    return { success: false, error: "Inspection comments must be 4000 characters or fewer." };
  }

  let checklist: unknown = {};
  try {
    checklist = checklistRaw ? JSON.parse(checklistRaw) : {};
  } catch {
    return { success: false, error: "The checklist submission is not valid JSON." };
  }

  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    return { success: false, error: "The inspection checklist has an invalid format." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_qc_inspection", {
    target_job_id: jobId,
    inspection_passed: passedStr === "true",
    submitted_checklist: checklist,
    inspection_comments: comments,
  });

  if (error) {
    console.error("QC inspection RPC failed:", error);
    return { success: false, error: `Failed to record QC inspection: ${error.message}` };
  }

  revalidatePath("/quality-control");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/technician");

  return { success: true };
}
