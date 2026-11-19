import { logoutAction } from "@/lib/auth/actions";
import type { UserProfile, Business } from "@/lib/auth/types";

export function Header({
  title,
  subheading,
  profile,
  business,
}: {
  title: string;
  subheading: string;
  profile?: UserProfile | null;
  business?: Business | null;
}) {
  const roleBadgeColors: Record<string, string> = {
    OWNER_ADMIN: "bg-purple-100 text-purple-800 border-purple-200",
    DISPATCHER: "bg-blue-100 text-blue-800 border-blue-200",
    TECHNICIAN: "bg-emerald-100 text-emerald-800 border-emerald-200",
    QC_REVIEWER: "bg-amber-100 text-amber-800 border-amber-200",
    CUSTOMER: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const userInitial = profile?.full_name?.charAt(0).toUpperCase() || "U";

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              {business?.name || "Repair Operations"}
            </p>
            {profile?.role ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  roleBadgeColors[profile.role] || "bg-slate-100 text-slate-700"
                }`}
              >
                {profile.role.replace("_", " ")}
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">
            {title}
          </h1>
        </div>

        {profile ? (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 leading-tight">
                {profile.full_name}
              </p>
              <p className="text-xs text-slate-500">{profile.email}</p>
            </div>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow-sm"
              title={`${profile.full_name} (${profile.role})`}
            >
              {userInitial}
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <span className="hidden rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 sm:inline-flex">
            Sample data
          </span>
        )}
      </div>

      <div className="px-4 pb-4 text-sm text-slate-500 sm:px-6 lg:px-8">
        {subheading}
      </div>
    </header>
  );
}
