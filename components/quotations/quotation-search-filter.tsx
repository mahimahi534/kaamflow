"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function QuotationSearchFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get("search") || "";
  const currentStatus = searchParams.get("status") || "all";
  const currentDateFrom = searchParams.get("dateFrom") || "";
  const currentDateTo = searchParams.get("dateTo") || "";

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "" || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function handleReset() {
    startTransition(() => {
      router.push(pathname);
    });
  }

  const hasActiveFilters =
    Boolean(currentSearch) ||
    currentStatus !== "all" ||
    Boolean(currentDateFrom) ||
    Boolean(currentDateTo);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative min-w-[220px] flex-1">
          <input
            type="text"
            placeholder="Search quotations, customer, notes..."
            defaultValue={currentSearch}
            onChange={(e) => updateParams({ search: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Status filter dropdown */}
        <select
          value={currentStatus}
          onChange={(e) => updateParams({ status: e.target.value })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Awaiting Approval (Sent)</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>

        {/* Date From */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>From:</span>
          <input
            type="date"
            value={currentDateFrom}
            onChange={(e) => updateParams({ dateFrom: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Date To */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>To:</span>
          <input
            type="date"
            value={currentDateTo}
            onChange={(e) => updateParams({ dateTo: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 underline cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {isPending && (
        <span className="text-xs text-blue-600 animate-pulse">Updating...</span>
      )}
    </div>
  );
}
