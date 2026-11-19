import type { ReactNode } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { getAuthSession } from "@/lib/auth/server";

export async function AppShell({
  title,
  subheading,
  children,
}: {
  title: string;
  subheading: string;
  children: ReactNode;
}) {
  const session = await getAuthSession();

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-[1600px] p-3 sm:p-5 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
          <Sidebar
            role={session?.profile?.role}
            businessName={session?.business?.name}
          />
          <main className="min-w-0 flex-1 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:rounded-[28px]">
            <Header
              title={title}
              subheading={subheading}
              profile={session?.profile}
              business={session?.business}
            />
            <div className="space-y-5 p-4 sm:space-y-6 sm:p-6">
              {session?.profile ? (
                <div
                  role="status"
                  className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-xs text-blue-950 sm:text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-600" />
                    <span>
                      Tenant Session Active:{" "}
                      <strong className="font-semibold text-blue-900">
                        {session.business?.name || "KAAMFLOW"}
                      </strong>{" "}
                      &bull; Logged in as{" "}
                      <span className="font-medium text-blue-800">
                        {session.profile.full_name} ({session.profile.role})
                      </span>
                    </span>
                  </div>
                  <span className="hidden rounded-md bg-blue-200/60 px-2 py-0.5 text-[11px] font-semibold text-blue-800 sm:inline-block">
                    RLS Enforced
                  </span>
                </div>
              ) : (
                <div
                  role="status"
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  <span className="font-semibold">UI preview:</span> all displayed
                  records are temporary sample data.
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
