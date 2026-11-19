import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth/server";
import { getCustomers } from "@/lib/dal/customers";
import { EquipmentForm } from "@/components/equipment/equipment-form";

export default async function NewEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/equipment");
  const businessId = session.profile.business_id;

  const resolvedParams = await searchParams;
  const defaultCustomerId = resolvedParams.customerId;

  const { data: customerList } = await getCustomers(businessId);

  return (
    <AppShell
      title="Register Equipment"
      subheading="Add customer equipment, appliances, electronics, and unique serial tags to the workshop registry."
    >
      <div className="mx-auto max-w-3xl">
        {customerList.length === 0 ? (
          <Panel title="No Customers Available">
            <div className="py-6">
              <EmptyState
                title="Customer Required"
                description="Equipment must be linked to an existing customer record. Please add a customer first."
              />
              <div className="mt-4 flex justify-center">
                <Link href="/customers/new">
                  <Button>Add Customer First</Button>
                </Link>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel
            title="Equipment Details"
            action={<StatusBadge label="New Device" tone="primary" />}
          >
            <EquipmentForm
              customers={customerList}
              defaultCustomerId={defaultCustomerId}
            />
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
