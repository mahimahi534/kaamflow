import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getCustomers } from "@/lib/dal/customers";
import { getAssets } from "@/lib/dal/equipment";
import { generateUniqueRequestReference } from "@/lib/dal/service-requests";
import { RequestForm } from "@/components/requests/request-form";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; assetId?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/requests");
  const businessId = session.profile.business_id;

  const resolvedParams = await searchParams;
  const defaultCustomerId = resolvedParams.customerId;
  const defaultAssetId = resolvedParams.assetId;

  const [{ data: customerList }, { data: assetList }, suggestedReference] = await Promise.all([
    getCustomers(businessId),
    getAssets(businessId),
    generateUniqueRequestReference(),
  ]);

  return (
    <AppShell
      title="New Service Request"
      subheading="Intake customer repair request, document reported symptoms, urgency priority, and scheduling."
    >
      <div className="mx-auto max-w-4xl">
        <Panel
          title="Service Intake Form"
          action={<StatusBadge label="New Request" tone="primary" />}
        >
          <RequestForm
            customers={customerList}
            assets={assetList}
            defaultCustomerId={defaultCustomerId}
            defaultAssetId={defaultAssetId}
            suggestedReference={suggestedReference}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
