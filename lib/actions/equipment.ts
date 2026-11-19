"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { Asset } from "@/lib/types/database";

export interface AssetFormState {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  asset?: Asset;
}

/**
 * Server Action: Register new Equipment (Asset).
 * Role required: OWNER_ADMIN or DISPATCHER.
 * Enforces business_id from server session.
 */
export async function createAssetAction(
  _prevState: AssetFormState,
  formData: FormData
): Promise<AssetFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found for your profile." };
  }

  const customerId = formData.get("customerId")?.toString().trim();
  const category = formData.get("category")?.toString().trim();
  const brand = formData.get("brand")?.toString().trim() || null;
  const model = formData.get("model")?.toString().trim() || null;
  const serialNumber = formData.get("serialNumber")?.toString().trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!customerId) {
    fieldErrors.customerId = "Customer is required. Please select or add an equipment owner.";
  }
  if (!category) {
    fieldErrors.category = "Equipment category is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  // Validate that the customer actually exists in this business
  const { data: customerRecord, error: custErr } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId!)
    .eq("business_id", businessId)
    .maybeSingle();

  if (custErr || !customerRecord) {
    return {
      success: false,
      fieldErrors: { customerId: "The selected customer was not found in your business." },
      error: "Invalid customer selected.",
    };
  }

  const { data, error } = await supabase
    .from("assets")
    .insert({
      business_id: businessId,
      customer_id: customerId!,
      category: category!,
      brand,
      model,
      serial_number: serialNumber,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating equipment:", error);
    return {
      success: false,
      error: `Failed to register equipment: ${error.message}`,
    };
  }

  revalidatePath("/equipment");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/equipment/${data.id}`);
}

/**
 * Server Action: Update existing Equipment (Asset).
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function updateAssetAction(
  assetId: string,
  _prevState: AssetFormState,
  formData: FormData
): Promise<AssetFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found." };
  }

  if (!assetId) {
    return { success: false, error: "Asset ID is required." };
  }

  const customerId = formData.get("customerId")?.toString().trim();
  const category = formData.get("category")?.toString().trim();
  const brand = formData.get("brand")?.toString().trim() || null;
  const model = formData.get("model")?.toString().trim() || null;
  const serialNumber = formData.get("serialNumber")?.toString().trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!category) {
    fieldErrors.category = "Category is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  const updatePayload: Record<string, unknown> = {
    category: category!,
    brand,
    model,
    serial_number: serialNumber,
    updated_at: new Date().toISOString(),
  };

  // If customer is being changed
  if (customerId) {
    const { data: customerRecord } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (customerRecord) {
      updatePayload.customer_id = customerId;
    }
  }

  const { data, error } = await supabase
    .from("assets")
    .update(updatePayload)
    .eq("id", assetId)
    .eq("business_id", businessId)
    .select()
    .single();

  if (error) {
    console.error("Error updating equipment:", error);
    return {
      success: false,
      error: `Failed to update equipment: ${error.message}`,
    };
  }

  revalidatePath("/equipment");
  revalidatePath(`/equipment/${assetId}`);
  if (data.customer_id) {
    revalidatePath(`/customers/${data.customer_id}`);
  }
  redirect(`/equipment/${assetId}`);
}
