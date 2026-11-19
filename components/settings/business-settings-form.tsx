"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateBusinessSettingsAction } from "@/lib/actions/settings";
import type { BusinessSettings } from "@/lib/dal/settings";

export function BusinessSettingsForm({
  settings,
}: {
  settings: BusinessSettings;
}) {
  const [state, formAction, isPending] = useActionState(updateBusinessSettingsAction, null);
  const [saved, setSaved] = useState(false);

  // Show saved message briefly
  if (state?.success && !saved) {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <form action={formAction} className="space-y-5 text-sm">
      {state?.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-semibold">
          {state.error}
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 font-semibold">
          ✓ Settings saved successfully.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="name" className="font-bold text-xs uppercase tracking-wide text-slate-500">
            Business Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={settings.name}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="operating_hours" className="font-bold text-xs uppercase tracking-wide text-slate-500">
            Operating Hours
          </label>
          <input
            id="operating_hours"
            name="operating_hours"
            type="text"
            defaultValue={settings.operating_hours || ""}
            placeholder="e.g. Mon-Fri 8:00 AM - 6:00 PM"
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="service_categories" className="font-bold text-xs uppercase tracking-wide text-slate-500">
          Service Categories (comma-separated)
        </label>
        <input
          id="service_categories"
          name="service_categories"
          type="text"
          defaultValue={(settings.service_categories || []).join(", ")}
          placeholder="e.g. Mobile Phones, Refrigerators, Washing Machines, Air Conditioners"
          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="coverage_notes" className="font-bold text-xs uppercase tracking-wide text-slate-500">
          Coverage & Service Area Notes
        </label>
        <textarea
          id="coverage_notes"
          name="coverage_notes"
          rows={2}
          defaultValue={settings.coverage_notes || ""}
          placeholder="e.g. Serving the greater metro area. Walk-in and scheduled appointments available."
          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="follow_up_interval_days" className="font-bold text-xs uppercase tracking-wide text-slate-500">
            Follow-Up Interval (days)
          </label>
          <input
            id="follow_up_interval_days"
            name="follow_up_interval_days"
            type="number"
            min={1}
            max={90}
            defaultValue={settings.follow_up_interval_days ?? 7}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="observation_window_days" className="font-bold text-xs uppercase tracking-wide text-slate-500">
            Observation Window (days)
          </label>
          <input
            id="observation_window_days"
            name="observation_window_days"
            type="number"
            min={7}
            max={365}
            defaultValue={settings.observation_window_days ?? 30}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="min_sample_size" className="font-bold text-xs uppercase tracking-wide text-slate-500">
            Min Sample Size
          </label>
          <input
            id="min_sample_size"
            name="min_sample_size"
            type="number"
            min={5}
            max={200}
            defaultValue={settings.min_sample_size ?? 20}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-[10px] text-slate-400">
            Analytics metrics with fewer cases than this threshold will be flagged as unreliable.
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-3 border-t border-slate-100">
        <Button type="submit" disabled={isPending} className="text-xs py-2 px-5">
          {isPending ? "Saving..." : "Save Business Settings"}
        </Button>
      </div>
    </form>
  );
}
