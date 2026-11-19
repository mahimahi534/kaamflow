"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteAllowedForRole, type UserRole } from "@/lib/auth/types";

const allNavItems = [
  { href: "/", label: "Dashboard", icon: "◫" },
  { href: "/technician", label: "Workbench", icon: "⚡" },
  { href: "/customers", label: "Customers", icon: "◎" },
  { href: "/equipment", label: "Equipment", icon: "◇" },
  { href: "/requests", label: "Service requests", icon: "▣" },
  { href: "/jobs", label: "Repair jobs", icon: "◌" },
  { href: "/quotations", label: "Quotations", icon: "≡" },
  { href: "/technicians", label: "Technicians", icon: "◍" },
  { href: "/quality-control", label: "Quality control", icon: "✓" },
  { href: "/fixloop", label: "FixLoop", icon: "↻" },
  { href: "/analytics", label: "Analytics", icon: "◔" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar({
  role,
  businessName,
}: {
  role?: UserRole;
  businessName?: string;
}) {
  const pathname = usePathname();

  // Filter items based on the user's verified role if provided
  const visibleItems = role
    ? allNavItems.filter((item) => isRouteAllowedForRole(item.href, role))
    : allNavItems;

  return (
    <>
      <aside className="sticky top-8 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col rounded-[24px] bg-slate-900 p-5 text-slate-100 shadow-[0_30px_60px_rgba(15,23,42,0.2)] lg:flex">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-600/40">
            K
          </div>
          <div>
            <p className="text-lg font-semibold tracking-wide">KAAMFLOW</p>
            <p className="text-xs text-slate-400">
              {businessName || "Repair Ops Suite"}
            </p>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`nav-button ${
                  active
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span aria-hidden="true" className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-800/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
            Security Status
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs font-semibold text-white">
              {role ? role.replace("_", " ") : "Authenticated Session"}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {businessName ? `Tenant: ${businessName}` : "Supabase RLS active"}
          </p>
        </div>
      </aside>

      <div className="mb-3 w-full lg:hidden">
        <div className="mb-2 flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
            K
          </div>
          <span className="text-sm font-bold tracking-wide text-slate-900">
            KAAMFLOW
          </span>
          {role ? (
            <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
              {role}
            </span>
          ) : null}
        </div>
        <nav
          aria-label="Main navigation"
          className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-900 p-2 text-white"
        >
          {visibleItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                  active ? "bg-blue-600 text-white" : "text-slate-300"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
