import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getServiceRequestById } from "@/lib/dal/service-requests";
import { getCustomers } from "@/lib/dal/customers";
import { getAssets } from "@/lib/dal/equipment";
import { RequestForm } from "@/components/requests/request-form";

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/requests");
  const businessId = session.profile.business_id;
  const { id } = await params;

  const [
    { data: request, error },
    { data: customerList },
    { data: assetList },
  ] = await Promise.all([
    getServiceRequestById(id),
    getCustomers(businessId),
    getAssets(businessId),
  ]);

  if (error || !request) {
    notFound();
  }

  return (
    <AppShell
      title={`Edit Request ${request.request_reference}`}
      subheading="Update customer contact, equipment assignment, symptoms, or urgency level."
    >
      <div className="mx-auto max-w-4xl">
        <Panel
          title="Edit Service Request"
          action={<StatusBadge label="Updating Request" tone="warning" />}
        >
          <RequestForm
            request={request}
            customers={customerList}
            assets={assetList}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
