"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Action: Update business profile settings.
 * Owner-only.
 */
export async function updateBusinessSettingsAction(
  _prevState: { success: boolean; error?: string } | null,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const name = formData.get("name")?.toString().trim();
  const operatingHours = formData.get("operating_hours")?.toString().trim() || null;
  const coverageNotes = formData.get("coverage_notes")?.toString().trim() || null;
  const serviceCategoriesRaw = formData.get("service_categories")?.toString().trim() || "";
  const followUpInterval = parseInt(formData.get("follow_up_interval_days")?.toString() || "7", 10);
  const observationWindow = parseInt(formData.get("observation_window_days")?.toString() || "30", 10);
  const minSampleSize = parseInt(formData.get("min_sample_size")?.toString() || "20", 10);

  if (!name) {
    return { success: false, error: "Business name is required." };
  }

  const serviceCategories = serviceCategoriesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const supabase = await createClient();

  const { error } = await supabase
    .from("businesses")
    .update({
      name,
      operating_hours: operatingHours,
      coverage_notes: coverageNotes,
      service_categories: serviceCategories.length > 0 ? serviceCategories : null,
      follow_up_interval_days: isNaN(followUpInterval) ? 7 : followUpInterval,
      observation_window_days: isNaN(observationWindow) ? 30 : observationWindow,
      min_sample_size: isNaN(minSampleSize) ? 20 : minSampleSize,
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId);

  if (error) {
    return { success: false, error: `Failed to update settings: ${error.message}` };
  }

  revalidatePath("/settings");
  return { success: true };
}

/**
 * Server Action: Toggle team member active status.
 * Owner-only.
 */
export async function toggleTeamMemberStatusAction(
  profileId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  // Prevent deactivating self
  if (profileId === session.profile.id) {
    return { success: false, error: "You cannot deactivate your own account." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .eq("business_id", businessId);

  if (error) {
    return { success: false, error: `Failed to update member status: ${error.message}` };
  }

  revalidatePath("/settings");
  return { success: true };
}

/**
 * Server Action: Update a team member's role.
 * Owner-only.
 */
export async function updateTeamMemberRoleAction(
  profileId: string,
  newRole: string
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const validRoles = ["OWNER_ADMIN", "DISPATCHER", "TECHNICIAN", "QC_REVIEWER"];
  if (!validRoles.includes(newRole)) {
    return { success: false, error: "Invalid role." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .eq("business_id", businessId);

  if (error) {
    return { success: false, error: `Failed to update role: ${error.message}` };
  }

  revalidatePath("/settings");
  return { success: true };
}
