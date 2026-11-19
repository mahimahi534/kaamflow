"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import {
  createServiceRequestAction,
  updateServiceRequestAction,
  type ServiceRequestFormState,
} from "@/lib/actions/service-requests";
import type { Customer, Asset, ServiceRequest } from "@/lib/types/database";

const initialState: ServiceRequestFormState = {
  success: false,
};

const COMMON_CATEGORIES = [
  "Appliance",
  "Mobile Phone",
  "Tablet",
  "Laptop",
  "Desktop Computer",
  "Audio / Hi-Fi",
  "TV / Display",
  "Power Tool",
  "HVAC / Cooling",
  "Other",
];

export function RequestForm({
  request,
  customers,
  assets,
  defaultCustomerId,
  defaultAssetId,
  suggestedReference,
}: {
  request?: ServiceRequest | null;
  customers: Pick<Customer, "id" | "full_name" | "phone" | "email">[];
  assets: Pick<Asset, "id" | "customer_id" | "category" | "brand" | "model" | "serial_number">[];
  defaultCustomerId?: string;
  defaultAssetId?: string;
  suggestedReference?: string;
}) {
  const isEditing = Boolean(request?.id);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    request?.customer_id || defaultCustomerId || ""
  );
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    request?.asset_id || defaultAssetId || ""
  );

  const [customerName, setCustomerName] = useState<string>(
    request?.customer_name || ""
  );
  const [phone, setPhone] = useState<string>(
    request?.phone || ""
  );
  const [equipmentCategory, setEquipmentCategory] = useState<string>(
    request?.equipment_category || "Appliance"
  );
  const [brandModel, setBrandModel] = useState<string>(
    request?.brand_model || ""
  );

  const actionToUse = isEditing && request
    ? updateServiceRequestAction.bind(null, request.id)
    : createServiceRequestAction;

  const [state, formAction, isPending] = useActionState(actionToUse, initialState);

  // When customer is picked, autofill customer name & phone if not yet filled
  function handleCustomerChange(custId: string) {
    setSelectedCustomerId(custId);
    const found = customers.find((c) => c.id === custId);
    if (found) {
      setCustomerName(found.full_name);
      if (found.phone) setPhone(found.phone);
    }
    // Also reset selected asset if it doesn't belong to this customer
    const validAsset = assets.find((a) => a.id === selectedAssetId && a.customer_id === custId);
    if (!validAsset) {
      setSelectedAssetId("");
    }
  }

  // When asset is picked, autofill equipment category & brand/model
  function handleAssetChange(astId: string) {
    setSelectedAssetId(astId);
    const found = assets.find((a) => a.id === astId);
    if (found) {
      setEquipmentCategory(found.category);
      const bm = [found.brand, found.model].filter(Boolean).join(" ");
      if (bm) setBrandModel(bm);
      // Also lock or sync customer if not selected
      if (!selectedCustomerId && found.customer_id) {
        handleCustomerChange(found.customer_id);
      }
    }
  }

  // Filter assets to those owned by the selected customer, or all if none selected
  const availableAssets = selectedCustomerId
    ? assets.filter((a) => a.customer_id === selectedCustomerId)
    : assets;

  // Format existing appointment for datetime-local input
  let appointmentInputValue = "";
  if (request?.preferred_appointment) {
    try {
      const dt = new Date(request.preferred_appointment);
      appointmentInputValue = dt.toISOString().slice(0, 16);
    } catch {
      // ignore
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <p className="font-semibold">{state.error}</p>
        </div>
      ) : null}

      {/* Step 1: Account / Customer Linking */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          1. Customer Information
        </h3>

        <div className="grid gap-6 md:grid-cols-3">
          <FormField
            label="Link Existing Customer (Optional)"
            hint="Auto-fills details and links to customer repair profile"
          >
            <select
              name="customerId"
              value={selectedCustomerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- Guest / Unlinked Intake --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Customer Name *"
            hint={state.fieldErrors?.customerName}
          >
            <input
              type="text"
              name="customerName"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Mason Brooks"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </FormField>

          <FormField
            label="Phone Number *"
            hint={state.fieldErrors?.phone}
          >
            <input
              type="tel"
              name="phone"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. (415) 290-1178"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </FormField>
        </div>
      </div>

      {/* Step 2: Equipment / Device Details */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          2. Equipment Details
        </h3>

        <div className="grid gap-6 md:grid-cols-3">
          <FormField
            label="Link Registered Asset (Optional)"
            hint={
              availableAssets.length > 0
                ? "Select previously registered device"
                : "No saved assets found for this customer"
            }
          >
            <select
              name="assetId"
              value={selectedAssetId}
              onChange={(e) => handleAssetChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- New / Unregistered Device --</option>
              {availableAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.category}: {a.brand || ""} {a.model || ""} {a.serial_number ? `[${a.serial_number}]` : ""}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Equipment Category *"
            hint={state.fieldErrors?.equipmentCategory}
          >
            <select
              name="equipmentCategory"
              required
              value={equipmentCategory}
              onChange={(e) => setEquipmentCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {COMMON_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Brand and Model *"
            hint={state.fieldErrors?.brandModel || "e.g. Frigidaire Gallery, LG WM4000"}
          >
            <input
              type="text"
              name="brandModel"
              required
              value={brandModel}
              onChange={(e) => setBrandModel(e.target.value)}
              placeholder="e.g. Samsung Galaxy S23"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </FormField>
        </div>
      </div>

      {/* Step 3: Issue Description & Logistics */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          3. Issue Description & Priority
        </h3>

        <FormField
          label="Reported Problem *"
          hint={state.fieldErrors?.reportedProblem || "Describe symptoms, error codes, and failure conditions"}
        >
          <textarea
            name="reportedProblem"
            required
            rows={4}
            defaultValue={request?.reported_problem || ""}
            placeholder="Unit is not cooling and compressor cycles every few minutes with a loud hum..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>

        <div className="grid gap-6 md:grid-cols-3">
          <FormField
            label="Urgency Level *"
            hint={state.fieldErrors?.urgency || "Determines queue scheduling"}
          >
            <select
              name="urgency"
              required
              defaultValue={request?.urgency || "medium"}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="low">Low (Standard backlog)</option>
              <option value="medium">Medium (Standard 48-hr queue)</option>
              <option value="high">High (Priority 24-hr turnaround)</option>
              <option value="urgent">Urgent (Immediate critical dispatch)</option>
            </select>
          </FormField>

          <FormField
            label="Preferred Appointment / Window"
            hint="Customer desired inspection date/time"
          >
            <input
              type="datetime-local"
              name="preferredAppointment"
              defaultValue={appointmentInputValue}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </FormField>

          <FormField
            label="Request Reference Number"
            hint={
              isEditing
                ? "Immutable intake code"
                : "Auto-generated unique code (can customize)"
            }
          >
            <input
              type="text"
              name="requestReference"
              readOnly={isEditing}
              defaultValue={request?.request_reference || suggestedReference || ""}
              placeholder="e.g. KF-2411-1024"
              className={`w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono font-semibold text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                isEditing ? "bg-slate-100 cursor-not-allowed" : "bg-white"
              }`}
            />
          </FormField>
        </div>

        <div className="pt-2">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 transition">
            <input
              type="checkbox"
              name="privacyConsent"
              defaultChecked={request ? request.privacy_consent : true}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-slate-900">Privacy & Service Documentation Consent</span>
              <p className="text-xs text-slate-500 mt-0.5">
                Customer consents to repair documentation, photographic inspection evidence, and diagnostic testing.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-5">
        <Link
          href={isEditing && request ? `/requests/${request.id}` : "/requests"}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={isPending}>
          {isPending
            ? isEditing
              ? "Saving changes..."
              : "Submitting intake..."
            : isEditing
              ? "Save Changes"
              : "Submit Service Request"}
        </Button>
      </div>
    </form>
  );
}
