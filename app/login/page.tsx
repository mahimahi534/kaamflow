import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign In | KAAMFLOW",
  description: "Sign in to your KAAMFLOW repair operations workspace.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; message?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const nextUrl = resolvedParams.next;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-xl shadow-blue-500/30">
            <span className="text-2xl font-black text-white">K</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            KAAMFLOW
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Repair Operations & Outcome Intelligence
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-800/80 p-6 shadow-2xl backdrop-blur-md sm:p-8">
          <div className="mb-6 border-b border-slate-700/60 pb-5">
            <h2 className="text-lg font-semibold text-white">Sign In</h2>
            <p className="text-xs text-slate-400">
              Access your role-based workspace with your authorized credentials.
            </p>
          </div>

          <LoginForm nextUrl={nextUrl} />

          <div className="mt-6 border-t border-slate-700/60 pt-5">
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3.5 text-xs text-slate-400">
              <p className="font-semibold text-slate-300">Enterprise Access Security</p>
              <p className="mt-1 leading-relaxed">
                Staff accounts and roles (Owner/Admin, Dispatcher, Technician, QC Reviewer) are provisioned directly by your business administrator. Public self-registration is disabled.
              </p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500">
          KAAMFLOW Multi-Tenant Repair Operations Architecture &bull; Supabase RLS Protected
        </p>
      </div>
    </div>
  );
}
