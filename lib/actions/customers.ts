"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/lib/types/database";

export interface CustomerFormState {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  customer?: Customer;
}

/**
 * Server Action: Create a new Customer.
 * Role required: OWNER_ADMIN or DISPATCHER.
 * Enforces business_id from server session.
 */
export async function createCustomerAction(
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found for your profile." };
  }

  const fullName = formData.get("fullName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const email = formData.get("email")?.toString().trim() || null;
  const preferredContact = formData.get("preferredContact")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!fullName) {
    fieldErrors.fullName = "Full name or organization name is required.";
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please provide a valid email address.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      business_id: businessId,
      full_name: fullName!,
      phone,
      email,
      preferred_contact: preferredContact,
      notes,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating customer:", error);
    return {
      success: false,
      error: `Failed to create customer: ${error.message}`,
    };
  }

  revalidatePath("/customers");
  redirect(`/customers/${data.id}`);
}

/**
 * Server Action: Update an existing Customer.
 * Role required: OWNER_ADMIN or DISPATCHER.
 * Enforces business_id match via RLS and explicit query filter.
 */
export async function updateCustomerAction(
  customerId: string,
  _prevState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found." };
  }

  if (!customerId) {
    return { success: false, error: "Customer ID is required." };
  }

  const fullName = formData.get("fullName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const email = formData.get("email")?.toString().trim() || null;
  const preferredContact = formData.get("preferredContact")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!fullName) {
    fieldErrors.fullName = "Full name is required.";
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please provide a valid email address.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("customers")
    .update({
      full_name: fullName!,
      phone,
      email,
      preferred_contact: preferredContact,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("business_id", businessId);

  if (error) {
    console.error("Error updating customer:", error);
    return {
      success: false,
      error: `Failed to update customer: ${error.message}`,
    };
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
