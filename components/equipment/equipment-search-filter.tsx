"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const CATEGORIES = [
  { label: "All Categories", value: "all" },
  { label: "Appliance", value: "Appliance" },
  { label: "Mobile Phone", value: "Mobile Phone" },
  { label: "Tablet", value: "Tablet" },
  { label: "Laptop", value: "Laptop" },
  { label: "Desktop Computer", value: "Desktop Computer" },
  { label: "Audio / Hi-Fi", value: "Audio / Hi-Fi" },
  { label: "TV / Display", value: "TV / Display" },
  { label: "Power Tool", value: "Power Tool" },
  { label: "HVAC / Cooling", value: "HVAC / Cooling" },
  { label: "Other", value: "Other" },
];

export function EquipmentSearchFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get("search") || "";
  const currentCategory = searchParams.get("category") || "all";

  function updateParams(newParams: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(newParams)) {
      if (val && val !== "all") {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
          <svg
            className={`h-4 w-4 ${isPending ? "animate-spin text-blue-500" : "text-slate-400"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {isPending ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            )}
          </svg>
        </div>
        <input
          type="search"
          defaultValue={currentSearch}
          onChange={(e) => updateParams({ search: e.target.value.trim() || null })}
          placeholder="Search equipment by brand, model, serial..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="sm:w-56">
        <select
          value={currentCategory}
          onChange={(e) => updateParams({ category: e.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
