import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getCustomerById } from "@/lib/dal/customers";
import { CustomerForm } from "@/components/customers/customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/customers");
  const { id } = await params;

  const { data: customer, error } = await getCustomerById(id);

  if (error || !customer) {
    notFound();
  }

  return (
    <AppShell
      title={`Edit ${customer.full_name}`}
      subheading="Update contact details, preferred communication channel, or workshop notes."
    >
      <div className="mx-auto max-w-3xl">
        <Panel
          title="Edit Customer Profile"
          action={<StatusBadge label="Updating Record" tone="warning" />}
        >
          <CustomerForm customer={customer} />
        </Panel>
      </div>
    </AppShell>
  );
}
