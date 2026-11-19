"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { createAssetAction, updateAssetAction, type AssetFormState } from "@/lib/actions/equipment";
import type { Asset, Customer } from "@/lib/types/database";

const initialState: AssetFormState = {
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

export function EquipmentForm({
  asset,
  customers,
  defaultCustomerId,
}: {
  asset?: Asset | null;
  customers: Pick<Customer, "id" | "full_name" | "phone">[];
  defaultCustomerId?: string;
}) {
  const isEditing = Boolean(asset?.id);

  const actionToUse = isEditing && asset
    ? updateAssetAction.bind(null, asset.id)
    : createAssetAction;

  const [state, formAction, isPending] = useActionState(actionToUse, initialState);

  const selectedCustomerId = asset?.customer_id || defaultCustomerId || "";

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

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          label="Equipment Owner (Customer) *"
          hint={state.fieldErrors?.customerId || "Select customer profile"}
        >
          <select
            name="customerId"
            required
            defaultValue={selectedCustomerId}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="" disabled>
              -- Select a Customer --
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.phone ? `(${c.phone})` : ""}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Category *"
          hint={state.fieldErrors?.category || "Device type"}
        >
          <select
            name="category"
            required
            defaultValue={asset?.category || "Appliance"}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {COMMON_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          label="Brand / Manufacturer"
          hint={state.fieldErrors?.brand || "e.g. Apple, Samsung, Bosch, Dell"}
        >
          <input
            type="text"
            name="brand"
            defaultValue={asset?.brand || ""}
            placeholder="e.g. Whirlpool"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>

        <FormField
          label="Model / Model Number"
          hint={state.fieldErrors?.model || "e.g. Galaxy S23 Ultra, XPS 15 9520"}
        >
          <input
            type="text"
            name="model"
            defaultValue={asset?.model || ""}
            placeholder="e.g. Front Load 8kg Series 6"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>
      </div>

      <FormField
        label="Serial Number / Service Tag"
        hint="Unique device identifier or barcode"
      >
        <input
          type="text"
          name="serialNumber"
          defaultValue={asset?.serial_number || ""}
          placeholder="e.g. SN-883920194"
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </FormField>

      <div className="flex items-center justify-between border-t border-slate-200 pt-5">
        <Link
          href={isEditing && asset ? `/equipment/${asset.id}` : "/equipment"}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={isPending}>
          {isPending
            ? isEditing
              ? "Saving changes..."
              : "Registering equipment..."
            : isEditing
              ? "Save Changes"
              : "Register Equipment"}
        </Button>
      </div>
    </form>
  );
}
