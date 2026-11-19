"use server";

import { createClient } from "@/lib/supabase/server";

export interface PublicIntakeResult {
  success: boolean;
  referenceCode?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function submitPublicServiceRequestAction(
  _prevState: PublicIntakeResult | null,
  formData: FormData
): Promise<PublicIntakeResult> {
  if (formData.get("hp_company_website")?.toString().trim()) {
    return {
      success: false,
      error: "Unable to process this request. Please contact the service desk.",
    };
  }

  const fullName = formData.get("full_name")?.toString().trim() || "";
  const phone = formData.get("phone")?.toString().trim() || "";
  const email = formData.get("email")?.toString().trim() || null;
  const serviceAddress = formData.get("service_address")?.toString().trim() || null;
  const category = formData.get("category")?.toString().trim() || "";
  const brandModel = formData.get("brand_model")?.toString().trim() || "";
  const reportedProblem = formData.get("reported_problem")?.toString().trim() || "";
  const preferredAppointmentRaw = formData.get("preferred_appointment")?.toString().trim() || "";
  const visibleCondition = formData.get("visible_condition")?.toString().trim() || null;
  const accessoriesSupplied = formData.get("accessories_supplied")?.toString().trim() || null;
  const accessNotes = formData.get("access_notes")?.toString().trim() || null;
  const privacyConsent =
    formData.get("privacy_consent") === "on" || formData.get("privacy_consent") === "true";

  const fieldErrors: Record<string, string> = {};

  if (fullName.length < 2 || fullName.length > 200) {
    fieldErrors.full_name = "Name must be between 2 and 200 characters.";
  }
  if (phone.length < 7 || phone.length > 32) {
    fieldErrors.phone = "Phone number must be between 7 and 32 characters.";
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    fieldErrors.email = "Please provide a valid email address.";
  }
  if (serviceAddress && serviceAddress.length > 500) {
    fieldErrors.service_address = "Address must be 500 characters or fewer.";
  }
  if (!category || category.length > 120) {
    fieldErrors.category = "Select a valid equipment category.";
  }
  if (brandModel.length < 2 || brandModel.length > 200) {
    fieldErrors.brand_model = "Brand and model must be between 2 and 200 characters.";
  }
  if (reportedProblem.length < 10 || reportedProblem.length > 4000) {
    fieldErrors.reported_problem = "Describe the issue in 10 to 4000 characters.";
  }
  if (!privacyConsent) {
    fieldErrors.privacy_consent = "You must agree to the privacy policy to submit a service request.";
  }

  const optionalTextFields = [
    ["visible_condition", visibleCondition],
    ["accessories_supplied", accessoriesSupplied],
    ["access_notes", accessNotes],
  ] as const;
  for (const [field, value] of optionalTextFields) {
    if (value && value.length > 1000) {
      fieldErrors[field] = "This field must be 1000 characters or fewer.";
    }
  }

  let preferredAppointment: string | null = null;
  if (preferredAppointmentRaw) {
    const appointmentDate = new Date(preferredAppointmentRaw);
    if (Number.isNaN(appointmentDate.getTime())) {
      fieldErrors.preferred_appointment = "Enter a valid appointment date and time.";
    } else {
      preferredAppointment = appointmentDate.toISOString();
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      fieldErrors,
      error: "Please complete all required fields correctly.",
    };
  }

  const businessSlug = process.env.KAAMFLOW_PUBLIC_BUSINESS_SLUG?.trim();
  if (!businessSlug) {
    return {
      success: false,
      error: "Workshop intake is not configured. Please contact the service desk.",
    };
  }

  const supabase = await createClient();
  const { data: referenceCode, error } = await supabase.rpc("submit_public_service_request", {
    target_business_slug: businessSlug,
    submitted_customer_name: fullName,
    submitted_phone: phone,
    submitted_email: email,
    privacy_accepted: privacyConsent,
    submitted_service_address: serviceAddress,
    submitted_category: category,
    submitted_brand_model: brandModel,
    submitted_problem: reportedProblem,
    submitted_preferred_appointment: preferredAppointment,
    submitted_visible_condition: visibleCondition,
    submitted_accessories: accessoriesSupplied,
    submitted_access_notes: accessNotes,
  });

  if (error || !referenceCode) {
    console.error("Public service request RPC failed:", error);
    return {
      success: false,
      error: error?.message.includes("Too many requests")
        ? "Too many requests from this contact number. Please try again later."
        : "Workshop intake is temporarily unavailable. Please contact the service desk.",
    };
  }

  return { success: true, referenceCode };
}
