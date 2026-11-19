import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getAssets, getAssetCount } from "@/lib/dal/equipment";
import { EquipmentSearchFilter } from "@/components/equipment/equipment-search-filter";

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/equipment");
  const businessId = session.profile.business_id;

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search || "";
  const category = resolvedSearchParams.category || "all";

  const [{ data: assets, totalCount, error }, totalCountAll] = await Promise.all([
    getAssets(businessId, { search, category }),
    getAssetCount(businessId),
  ]);

  return (
    <AppShell
      title="Equipment"
      subheading="Manage registered customer appliances, electronics, serial tags, and repair histories."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Total Registered Equipment</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCountAll}</p>
          <p className="mt-1 text-xs text-slate-500">Across all customers</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Matching Query</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCount}</p>
          <p className="mt-1 text-xs text-slate-500">{search || category !== "all" ? "Filtered view" : "All devices"}</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Active Category</p>
          <p className="mt-2 text-xl font-semibold text-slate-900 capitalize">
            {category === "all" ? "All Categories" : category}
          </p>
          <p className="mt-1 text-xs text-slate-500">Filter applied</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Serial Tagged</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {assets.filter((a) => Boolean(a.serial_number)).length}
          </p>
          <p className="mt-1 text-xs text-slate-500">With unique serials</p>
        </article>
      </section>

      {/* Main Table Panel */}
      <Panel
        title="Equipment Registry"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label={`${totalCount} Total`} tone="primary" />
            <Link href="/equipment/new">
              <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Register Equipment
              </Button>
            </Link>
          </div>
        }
      >
        <div className="space-y-4">
          <EquipmentSearchFilter />

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Failed to load equipment</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : assets.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title={
                  search || category !== "all"
                    ? "No matching equipment found"
                    : "No equipment registered yet"
                }
                description={
                  search || category !== "all"
                    ? "Try adjusting your search query or category filter."
                    : "Register customer devices to maintain clear equipment histories."
                }
              />
              {!search && category === "all" && (
                <div className="mt-4 flex justify-center">
                  <Link href="/equipment/new">
                    <Button>Register First Equipment</Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-3.5">Category</th>
                    <th scope="col" className="px-4 py-3.5">Brand & Model</th>
                    <th scope="col" className="px-4 py-3.5">Serial / Tag</th>
                    <th scope="col" className="px-4 py-3.5">Customer Owner</th>
                    <th scope="col" className="px-4 py-3.5">Registered</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3.5 font-semibold text-slate-900">
                        <Link
                          href={`/equipment/${asset.id}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {asset.category}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-slate-800">
                        <span className="font-medium">{asset.brand || "Unknown Brand"}</span>{" "}
                        <span className="text-slate-500">{asset.model || ""}</span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-600">
                        {asset.serial_number ? (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold">
                            {asset.serial_number}
                          </span>
                        ) : (
                          <span className="italic text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {asset.customer ? (
                          <Link
                            href={`/customers/${asset.customer.id}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {asset.customer.full_name}
                          </Link>
                        ) : (
                          <span className="italic text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {new Date(asset.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/equipment/${asset.id}`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            View
                          </Link>
                          <Link
                            href={`/equipment/${asset.id}/edit`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
