import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { CustomerForm } from "@/components/customers/customer-form";

export default async function NewCustomerPage() {
  await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/customers");

  return (
    <AppShell
      title="Add Customer"
      subheading="Register a new customer account, contact details, and workshop preferences."
    >
      <div className="mx-auto max-w-3xl">
        <Panel
          title="Customer Profile Details"
          action={<StatusBadge label="New Account" tone="primary" />}
        >
          <CustomerForm />
        </Panel>
      </div>
    </AppShell>
  );
}
