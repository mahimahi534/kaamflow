"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { generateUniqueRequestReference } from "@/lib/dal/service-requests";
import type { ServiceRequest, UrgencyLevel } from "@/lib/types/database";

export interface ServiceRequestFormState {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  serviceRequest?: ServiceRequest;
}

const VALID_URGENCIES: UrgencyLevel[] = ["low", "medium", "high", "urgent"];

/**
 * Server Action: Create a new Service Request (Intake).
 * Role required: OWNER_ADMIN or DISPATCHER.
 * Enforces business_id from server session.
 */
export async function createServiceRequestAction(
  _prevState: ServiceRequestFormState,
  formData: FormData
): Promise<ServiceRequestFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found for your profile." };
  }

  const customerId = formData.get("customerId")?.toString().trim() || null;
  const assetId = formData.get("assetId")?.toString().trim() || null;
  const customerName = formData.get("customerName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim();
  const equipmentCategory = formData.get("equipmentCategory")?.toString().trim();
  const brandModel = formData.get("brandModel")?.toString().trim();
  const reportedProblem = formData.get("reportedProblem")?.toString().trim();
  const urgencyRaw = formData.get("urgency")?.toString().trim().toLowerCase() as UrgencyLevel;
  const preferredAppointment = formData.get("preferredAppointment")?.toString().trim() || null;
  const privacyConsent = formData.get("privacyConsent") === "true" || formData.get("privacyConsent") === "on";

  let requestReference = formData.get("requestReference")?.toString().trim();

  const fieldErrors: Record<string, string> = {};
  if (!customerName) {
    fieldErrors.customerName = "Customer name is required.";
  }
  if (!phone) {
    fieldErrors.phone = "Contact phone number is required.";
  }
  if (!equipmentCategory) {
    fieldErrors.equipmentCategory = "Equipment category is required.";
  }
  if (!brandModel) {
    fieldErrors.brandModel = "Equipment brand and model are required.";
  }
  if (!reportedProblem) {
    fieldErrors.reportedProblem = "Please describe the reported problem.";
  }
  if (!urgencyRaw || !VALID_URGENCIES.includes(urgencyRaw)) {
    fieldErrors.urgency = "Please select a valid urgency level (Low, Medium, High, Urgent).";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  // If request reference not provided or empty, generate one
  if (!requestReference) {
    requestReference = await generateUniqueRequestReference();
  }

  // Parse appointment date if present
  let appointmentDate: string | null = null;
  if (preferredAppointment) {
    const parsed = new Date(preferredAppointment);
    if (!isNaN(parsed.getTime())) {
      appointmentDate = parsed.toISOString();
    }
  }

  // Check if customerId is valid in business
  let validCustomerId: string | null = null;
  if (customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (cust) {
      validCustomerId = cust.id;
    }
  }

  // Check if assetId is valid in business
  let validAssetId: string | null = null;
  if (assetId) {
    const { data: ast } = await supabase
      .from("assets")
      .select("id")
      .eq("id", assetId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (ast) {
      validAssetId = ast.id;
    }
  }

  const { data, error } = await supabase
    .from("service_requests")
    .insert({
      business_id: businessId,
      customer_id: validCustomerId,
      asset_id: validAssetId,
      customer_name: customerName!,
      phone: phone!,
      equipment_category: equipmentCategory!,
      brand_model: brandModel!,
      reported_problem: reportedProblem!,
      urgency: urgencyRaw,
      preferred_appointment: appointmentDate,
      request_reference: requestReference,
      privacy_consent: privacyConsent,
      submitted_by_customer: false, // Created by staff member
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating service request:", error);
    return {
      success: false,
      error: `Failed to create service request: ${error.message}`,
    };
  }

  revalidatePath("/requests");
  if (validCustomerId) {
    revalidatePath(`/customers/${validCustomerId}`);
  }
  if (validAssetId) {
    revalidatePath(`/equipment/${validAssetId}`);
  }

  redirect(`/requests/${data.id}`);
}

/**
 * Server Action: Update existing Service Request.
 * Role required: OWNER_ADMIN or DISPATCHER.
 */
export async function updateServiceRequestAction(
  requestId: string,
  _prevState: ServiceRequestFormState,
  formData: FormData
): Promise<ServiceRequestFormState> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant found." };
  }

  if (!requestId) {
    return { success: false, error: "Request ID is required." };
  }

  const customerId = formData.get("customerId")?.toString().trim() || null;
  const assetId = formData.get("assetId")?.toString().trim() || null;
  const customerName = formData.get("customerName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim();
  const equipmentCategory = formData.get("equipmentCategory")?.toString().trim();
  const brandModel = formData.get("brandModel")?.toString().trim();
  const reportedProblem = formData.get("reportedProblem")?.toString().trim();
  const urgencyRaw = formData.get("urgency")?.toString().trim().toLowerCase() as UrgencyLevel;
  const preferredAppointment = formData.get("preferredAppointment")?.toString().trim() || null;
  const privacyConsent = formData.get("privacyConsent") === "true" || formData.get("privacyConsent") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!customerName) {
    fieldErrors.customerName = "Customer name is required.";
  }
  if (!phone) {
    fieldErrors.phone = "Phone is required.";
  }
  if (!equipmentCategory) {
    fieldErrors.equipmentCategory = "Equipment category is required.";
  }
  if (!brandModel) {
    fieldErrors.brandModel = "Brand and model are required.";
  }
  if (!reportedProblem) {
    fieldErrors.reportedProblem = "Reported problem is required.";
  }
  if (!urgencyRaw || !VALID_URGENCIES.includes(urgencyRaw)) {
    fieldErrors.urgency = "Invalid urgency level.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors, error: "Please fix the validation errors below." };
  }

  const supabase = await createClient();

  let appointmentDate: string | null = null;
  if (preferredAppointment) {
    const parsed = new Date(preferredAppointment);
    if (!isNaN(parsed.getTime())) {
      appointmentDate = parsed.toISOString();
    }
  }

  const updatePayload: Record<string, unknown> = {
    customer_name: customerName!,
    phone: phone!,
    equipment_category: equipmentCategory!,
    brand_model: brandModel!,
    reported_problem: reportedProblem!,
    urgency: urgencyRaw,
    preferred_appointment: appointmentDate,
    privacy_consent: privacyConsent,
    updated_at: new Date().toISOString(),
  };

  if (customerId !== undefined) {
    updatePayload.customer_id = customerId;
  }
  if (assetId !== undefined) {
    updatePayload.asset_id = assetId;
  }

  const { data, error } = await supabase
    .from("service_requests")
    .update(updatePayload)
    .eq("id", requestId)
    .eq("business_id", businessId)
    .select()
    .single();

  if (error) {
    console.error("Error updating service request:", error);
    return {
      success: false,
      error: `Failed to update service request: ${error.message}`,
    };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  if (data.customer_id) {
    revalidatePath(`/customers/${data.customer_id}`);
  }
  if (data.asset_id) {
    revalidatePath(`/equipment/${data.asset_id}`);
  }

  redirect(`/requests/${requestId}`);
}
