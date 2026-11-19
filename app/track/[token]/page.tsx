import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Repair Status Tracking | KAAMFLOW",
  description: "Live real-time repair progress tracking for your device.",
};

interface RpcTrackingResult {
  success: boolean;
  error?: string;
  job_code: string;
  status: string;
  reported_issue: string;
  equipment_category: string;
  brand: string | null;
  model: string | null;
  created_at: string;
  handed_over_at?: string | null;
  workshop_name: string;
  parts_status_note?: string | null;
  quote_summary?: {
    total: number;
    status: string;
  } | null;
}

const STEP_ORDER = [
  { key: "intake", label: "Intake & Received" },
  { key: "diagnosis", label: "Diagnostic Inspection" },
  { key: "quotation", label: "Estimate & Approval" },
  { key: "in_progress", label: "Bench Repair in Progress" },
  { key: "qc_review", label: "Quality Control" },
  { key: "completed", label: "Ready for Pickup" },
  { key: "handover", label: "Handover Completed" },
];

function getActiveStepIndex(status: string): number {
  switch (status) {
    case "new_request":
    case "intake":
      return 0;
    case "diagnosis":
      return 1;
    case "quotation":
    case "awaiting_customer_approval":
      return 2;
    case "assigned":
    case "in_progress":
    case "waiting_for_parts":
      return 3;
    case "qc_review":
      return 4;
    case "completed":
      return 5;
    case "handover":
    case "closed":
      return 6;
    default:
      return 0;
  }
}

export default async function CustomerTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 16) {
    notFound();
  }

  const supabase = await createClient();

  const { data: rawResult, error } = await supabase.rpc("get_public_job_tracking", {
    target_token: token,
  });

  const result = rawResult as unknown as RpcTrackingResult | null;

  if (error || !result || !result.success) {
    const errorMsg = result?.error || "Invalid or expired tracking link.";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-800/90 p-8 text-center shadow-2xl backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Tracking Link Unavailable</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{errorMsg}</p>
          <div className="mt-6 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-400">
            For assistance or a fresh tracking link, please contact your service desk with your reference code.
          </div>
        </div>
      </div>
    );
  }

  const track = result;

  const currentStep = getActiveStepIndex(track.status);
  const equipmentTitle = [track.brand, track.model].filter(Boolean).join(" ") || track.equipment_category;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-black text-white shadow-lg shadow-blue-500/20">
              K
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                Repair Tracker
              </span>
              <h1 className="text-sm font-bold text-white">{track.workshop_name}</h1>
            </div>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 font-mono text-xs font-semibold text-slate-300 border border-slate-700">
            {track.job_code}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
        {/* Device & Status Card */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur-sm space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {track.equipment_category}
              </span>
              <h2 className="text-xl font-bold text-white">{equipmentTitle}</h2>
            </div>
            <div className="inline-flex items-center gap-2 mt-1 sm:mt-0">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                {track.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Reported Symptom:</p>
            <p className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-slate-300 leading-relaxed">
              {track.reported_issue}
            </p>
          </div>

          {/* Waiting for Parts Notice if applicable */}
          {track.parts_status_note && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 space-y-1">
              <p className="font-bold uppercase tracking-wider text-[10px] text-amber-400">
                Procurement Notice & ETA
              </p>
              <p className="leading-relaxed">{track.parts_status_note}</p>
            </div>
          )}

          {/* Approved Quote Banner */}
          {track.quote_summary && track.quote_summary.status === "approved" && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300 flex items-center justify-between">
              <div>
                <p className="font-bold text-[10px] uppercase tracking-wider text-emerald-400">
                  Approved Repair Scope
                </p>
                <p className="mt-0.5 text-xs text-emerald-200">Customer authorized estimate</p>
              </div>
              <span className="text-base font-bold text-white">
                ${Number(track.quote_summary.total).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Multi-step Status Progress Timeline */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Repair Lifecycle Progress
          </h3>

          <div className="space-y-4 pt-2">
            {STEP_ORDER.map((step, idx) => {
              const isDone = idx < currentStep;
              const isCurrent = idx === currentStep;
              return (
                <div key={step.key} className="flex items-center gap-3.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                          ? "bg-blue-600 text-white ring-4 ring-blue-500/20"
                          : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {isDone ? "✓" : idx + 1}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-xs font-semibold ${
                        isCurrent
                          ? "text-blue-400 font-bold"
                          : isDone
                            ? "text-slate-200"
                            : "text-slate-500"
                      }`}
                    >
                      {step.label}
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-400 uppercase">
                      Current Phase
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>
          Secure Customer Tracking Portal &bull; Protected by KAAMFLOW Verified Token Architecture
        </p>
      </footer>
    </div>
  );
}
