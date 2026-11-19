import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getCustomers, getCustomerCount } from "@/lib/dal/customers";
import { CustomerSearchFilter } from "@/components/customers/customer-search-filter";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/customers");
  const businessId = session.profile.business_id;

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams.search || "";

  const [{ data: customerList, totalCount, error }, totalCountAll] = await Promise.all([
    getCustomers(businessId, { search }),
    getCustomerCount(businessId),
  ]);

  const withPhone = customerList.filter((c) => Boolean(c.phone)).length;
  const withEmail = customerList.filter((c) => Boolean(c.email)).length;

  return (
    <AppShell
      title="Customers"
      subheading="Manage customer profiles, contact directories, and service histories."
    >
      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="metric-card">
          <p className="text-sm text-slate-500">Total Customers</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCountAll}</p>
          <p className="mt-1 text-xs text-slate-500">Registered in your workshop</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">Matching Query</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalCount}</p>
          <p className="mt-1 text-xs text-slate-500">{search ? `Filter: "${search}"` : "All records"}</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">With Phone Contact</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{withPhone}</p>
          <p className="mt-1 text-xs text-slate-500">SMS / Call reachable</p>
        </article>
        <article className="metric-card">
          <p className="text-sm text-slate-500">With Email Address</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{withEmail}</p>
          <p className="mt-1 text-xs text-slate-500">Quotation ready</p>
        </article>
      </section>

      {/* Main Table Panel */}
      <Panel
        title="Customer Directory"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label={`${totalCount} Total`} tone="primary" />
            <Link href="/customers/new">
              <Button variant="primary" className="text-xs sm:text-sm py-1.5 px-3">
                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Customer
              </Button>
            </Link>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CustomerSearchFilter />
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Failed to load customers</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : customerList.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title={search ? "No matching customers found" : "No customers registered yet"}
                description={
                  search
                    ? `No customers matched "${search}". Try searching for a different name, phone, or email.`
                    : "Add your first customer to begin tracking equipment and service requests."
                }
              />
              {!search && (
                <div className="mt-4 flex justify-center">
                  <Link href="/customers/new">
                    <Button>Add First Customer</Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-3.5">Customer Name</th>
                    <th scope="col" className="px-4 py-3.5">Phone</th>
                    <th scope="col" className="px-4 py-3.5">Email</th>
                    <th scope="col" className="px-4 py-3.5">Preferred Contact</th>
                    <th scope="col" className="px-4 py-3.5">Registered</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customerList.map((customer) => (
                    <tr
                      key={customer.id}
                      className="transition-colors hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {customer.full_name}
                        </Link>
                        {customer.notes ? (
                          <p className="line-clamp-1 text-xs text-slate-400 mt-0.5">
                            {customer.notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700">
                        {customer.phone ? (
                          <span>{customer.phone}</span>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700">
                        {customer.email ? (
                          <span>{customer.email}</span>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge
                          label={customer.preferred_contact || "phone"}
                          tone="neutral"
                        />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {new Date(customer.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/customers/${customer.id}`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            View
                          </Link>
                          <Link
                            href={`/customers/${customer.id}/edit`}
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
