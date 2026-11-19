"use client";

import { useActionState } from "react";
import Link from "next/link";
import { submitPublicServiceRequestAction, type PublicIntakeResult } from "@/lib/actions/public-intake";

const CATEGORIES = [
  "Appliance (Refrigerator / Freezer)",
  "Appliance (Washing Machine / Dryer)",
  "Appliance (Oven / Cooktop / Microwave)",
  "HVAC / Air Conditioning",
  "Mobile Phone / Smartphone",
  "Tablet / iPad",
  "Laptop / MacBook",
  "Desktop Computer / Workstation",
  "Audio / Hi-Fi / Sound System",
  "TV / Television / Display",
  "Power Tool / Industrial",
  "UPS / Power Inverter",
  "Other Electronics",
];

const initialState: PublicIntakeResult = {
  success: false,
};

export default function PublicIntakePage() {
  const [state, formAction, isPending] = useActionState(submitPublicServiceRequestAction, initialState);

  if (state.success && state.referenceCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/90 p-8 text-center shadow-2xl backdrop-blur-md space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Request Received Successfully
            </span>
            <h1 className="mt-1 text-2xl font-bold text-white">Service Intake Logged</h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Your service request has been queued for workshop intake. The dispatch desk will review your problem description and confirm diagnostic scheduling.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Your Tracking Reference Code
            </p>
            <p className="font-mono text-xl font-black text-blue-400 select-all">
              {state.referenceCode}
            </p>
            <p className="text-[10px] text-slate-500 pt-1">
              Save this reference code for service desk inquiries.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/"
              className="inline-block rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              Return to Workshop Homepage
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-black text-white shadow-lg shadow-blue-500/20">
              K
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                KAAMFLOW Service Intake
              </span>
              <h1 className="text-sm font-bold text-white">Appliance & Electronics Repair Portal</h1>
            </div>
          </div>
          <Link
            href="/login"
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
          >
            Staff Sign In &rarr;
          </Link>
        </div>
      </header>

      {/* Main Public Form Container */}
      <main className="mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Book a Diagnostic Evaluation
          </h2>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            Submit your appliance or electronics issue for rapid workshop triage. Our technicians evaluate symptoms and provide transparent estimates before starting repairs.
          </p>
        </div>

        {state.error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 font-semibold">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-6">
          {/* Honeypot field (hidden from real users, caught by bots) */}
          <div className="hidden" aria-hidden="true">
            <input
              type="text"
              name="hp_company_website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          {/* Section 1: Customer Contact Details */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 border-b border-slate-800 pb-2">
              1. Customer Information
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Full Name or Organization *
                </label>
                <input
                  type="text"
                  name="full_name"
                  required
                  placeholder="e.g. Michael Abera"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {state.fieldErrors?.full_name && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.full_name}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Primary Contact Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  required
                  placeholder="e.g. +251 91 123 4567"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {state.fieldErrors?.phone && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.phone}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  name="email"
                  placeholder="e.g. michael@example.com"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {state.fieldErrors?.email && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.email}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Service / Pickup Address (Optional)
                </label>
                <input
                  type="text"
                  name="service_address"
                  placeholder="e.g. Bole Subcity, House 148, Addis Ababa"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {state.fieldErrors?.service_address && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.service_address}</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Equipment Information */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 border-b border-slate-800 pb-2">
              2. Equipment Details
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Equipment Category *
                </label>
                <select
                  name="category"
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                {state.fieldErrors?.category && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.category}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Brand and Model *
                </label>
                <input
                  type="text"
                  name="brand_model"
                  required
                  placeholder="e.g. Samsung Inverter RT38, Dell XPS 15"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {state.fieldErrors?.brand_model && (
                  <p className="text-[11px] text-rose-400">{state.fieldErrors.brand_model}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Visible Equipment Condition (Scratches, Dents)
                </label>
                <input
                  type="text"
                  name="visible_condition"
                  placeholder="e.g. Minor scratches on top panel, power cord intact"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Accessories Supplied (Charger, Remote, Cables)
                </label>
                <input
                  type="text"
                  name="accessories_supplied"
                  placeholder="e.g. Original AC adapter and remote control included"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Problem Description & Preferred Appointment */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-400 border-b border-slate-800 pb-2">
              3. Symptoms & Desired Appointment
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Detailed Problem Description *
              </label>
              <textarea
                name="reported_problem"
                rows={4}
                required
                placeholder="Describe exactly what happens: error codes, strange noises, when the failure began, and any previous repair history..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {state.fieldErrors?.reported_problem && (
                <p className="text-[11px] text-rose-400">{state.fieldErrors.reported_problem}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Preferred Diagnostic Window / Appointment
                </label>
                <input
                  type="datetime-local"
                  name="preferred_appointment"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Access or Gate Instructions (Optional)
                </label>
                <input
                  type="text"
                  name="access_notes"
                  placeholder="e.g. Ring bell at compound gate, elevator available"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Privacy & Consent */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="privacy_consent"
                required
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-400 leading-relaxed">
                I agree to the workshop privacy policy. I consent to KAAMFLOW storing my contact information and equipment details solely for the purpose of repair diagnostics, estimate communication, and service follow-up.
              </span>
            </label>
            {state.fieldErrors?.privacy_consent && (
              <p className="text-[11px] text-rose-400">{state.fieldErrors.privacy_consent}</p>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-2xl bg-blue-600 p-3.5 text-sm font-bold text-white shadow-xl shadow-blue-500/20 hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {isPending ? "Submitting Request..." : "Submit Diagnostic Service Request"}
            </button>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>
          KAAMFLOW Intake Engine &bull; Protected by Honeypot Bot Guards and Secure Multi-Tenant Architecture
        </p>
      </footer>
    </div>
  );
}
