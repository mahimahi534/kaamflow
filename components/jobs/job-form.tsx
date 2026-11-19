"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { createJobAction, type JobFormState } from "@/lib/actions/jobs";
import type { Customer, Asset, ServiceRequest } from "@/lib/types/database";

const initialState: JobFormState = {
  success: false,
};

export function JobForm({
  customers,
  assets,
  requests,
  defaultCustomerId,
  defaultAssetId,
  defaultRequestId,
}: {
  customers: Pick<Customer, "id" | "full_name" | "phone">[];
  assets: Pick<Asset, "id" | "customer_id" | "category" | "brand" | "model" | "serial_number">[];
  requests: Pick<ServiceRequest, "id" | "request_reference" | "customer_id" | "asset_id" | "equipment_category" | "brand_model" | "reported_problem">[];
  defaultCustomerId?: string;
  defaultAssetId?: string;
  defaultRequestId?: string;
}) {
  const [selectedCustId, setSelectedCustId] = useState<string>(defaultCustomerId || "");
  const [selectedAssetId, setSelectedAssetId] = useState<string>(defaultAssetId || "");
  const [issueSummary, setIssueSummary] = useState<string>("");

  const [state, formAction, isPending] = useActionState(createJobAction, initialState);

  // If a service request is picked, auto-populate customer, asset, and issue summary
  function handleRequestChange(reqId: string) {
    const found = requests.find((r) => r.id === reqId);
    if (found) {
      if (found.customer_id) setSelectedCustId(found.customer_id);
      if (found.asset_id) setSelectedAssetId(found.asset_id);
      setIssueSummary(`${found.equipment_category} ${found.brand_model}: ${found.reported_problem}`);
    }
  }

  const availableAssets = selectedCustId
    ? assets.filter((a) => a.customer_id === selectedCustId)
    : assets;

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <p className="font-semibold">{state.error}</p>
        </div>
      )}

      {requests.length > 0 && (
        <FormField
          label="Link Intake Service Request (Optional)"
          hint="Automatically fills customer, equipment, and symptom descriptions"
        >
          <select
            name="serviceRequestId"
            defaultValue={defaultRequestId || ""}
            onChange={(e) => handleRequestChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Direct Job (No Prior Intake Request) --</option>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.request_reference} - {r.equipment_category} ({r.brand_model})
              </option>
            ))}
          </select>
        </FormField>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          label="Customer *"
          hint="Account owner requesting repair"
        >
          <select
            name="customerId"
            value={selectedCustId}
            onChange={(e) => setSelectedCustId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Select Customer (Optional) --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.phone ? `(${c.phone})` : ""}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Equipment / Asset"
          hint="Device undergoing repair"
        >
          <select
            name="assetId"
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Select Equipment (Optional) --</option>
            {availableAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.category}: {a.brand || ""} {a.model || ""} {a.serial_number ? `[${a.serial_number}]` : ""}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField
        label="Issue Summary & Primary Fault *"
        hint={state.fieldErrors?.issueSummary || "High-level summary of the customer's problem or repair scope"}
      >
        <textarea
          name="issueSummary"
          required
          rows={3}
          value={issueSummary}
          onChange={(e) => setIssueSummary(e.target.value)}
          placeholder="e.g. Washing machine not spinning during cycle; customer heard grinding noise..."
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </FormField>

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          label="Initial Status *"
          hint="Current stage in the repair pipeline"
        >
          <select
            name="status"
            defaultValue="intake"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="intake">Intake (At workshop)</option>
            <option value="diagnosis">Diagnosis (Under evaluation)</option>
          </select>
        </FormField>

        <FormField
          label="Initial Diagnosis Notes (Optional)"
          hint="Bench technician inspection notes"
        >
          <input
            type="text"
            name="diagnosisNotes"
            placeholder="Preliminary visual check or initial meter reading"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-5">
        <Link
          href="/jobs"
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating repair job..." : "Create Repair Job"}
        </Button>
      </div>
    </form>
  );
}
