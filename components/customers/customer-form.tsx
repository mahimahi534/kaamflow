"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { createCustomerAction, updateCustomerAction, type CustomerFormState } from "@/lib/actions/customers";
import type { Customer } from "@/lib/types/database";

const initialState: CustomerFormState = {
  success: false,
};

export function CustomerForm({
  customer,
}: {
  customer?: Customer | null;
}) {
  const isEditing = Boolean(customer?.id);

  // Bind update action with customer ID if editing
  const actionToUse = isEditing && customer
    ? updateCustomerAction.bind(null, customer.id)
    : createCustomerAction;

  const [state, formAction, isPending] = useActionState(actionToUse, initialState);

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
          label="Full Name or Organization *"
          hint={state.fieldErrors?.fullName}
        >
          <input
            type="text"
            name="fullName"
            required
            defaultValue={customer?.full_name || ""}
            placeholder="e.g. Acme Corporation or John Doe"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>

        <FormField
          label="Phone Number"
          hint={state.fieldErrors?.phone || "Primary contact phone"}
        >
          <input
            type="tel"
            name="phone"
            defaultValue={customer?.phone || ""}
            placeholder="e.g. +1 (555) 234-5678"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <FormField
          label="Email Address"
          hint={state.fieldErrors?.email || "For quotes and service updates"}
        >
          <input
            type="email"
            name="email"
            defaultValue={customer?.email || ""}
            placeholder="e.g. contact@example.com"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </FormField>

        <FormField
          label="Preferred Contact Method"
          hint="How this customer prefers to be reached"
        >
          <select
            name="preferredContact"
            defaultValue={customer?.preferred_contact || "phone"}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="phone">Phone call</option>
            <option value="sms">SMS / Text message</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </FormField>
      </div>

      <FormField
        label="Customer Notes & Service Preferences"
        hint="Internal notes, gate codes, delivery instructions, billing details"
      >
        <textarea
          name="notes"
          rows={4}
          defaultValue={customer?.notes || ""}
          placeholder="Special requirements, account terms, service histories..."
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </FormField>

      <div className="flex items-center justify-between border-t border-slate-200 pt-5">
        <Link
          href={isEditing && customer ? `/customers/${customer.id}` : "/customers"}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={isPending}>
          {isPending
            ? isEditing
              ? "Saving changes..."
              : "Creating customer..."
            : isEditing
              ? "Save Changes"
              : "Create Customer"}
        </Button>
      </div>
    </form>
  );
}
