import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getCustomers } from "@/lib/dal/customers";
import { getAssets } from "@/lib/dal/equipment";
import { getServiceRequests } from "@/lib/dal/service-requests";
import { JobForm } from "@/components/jobs/job-form";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; assetId?: string; requestId?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/jobs");
  const businessId = session.profile.business_id;

  const resolvedParams = await searchParams;
  const defaultCustomerId = resolvedParams.customerId;
  const defaultAssetId = resolvedParams.assetId;
  const defaultRequestId = resolvedParams.requestId;

  const [{ data: customerList }, { data: assetList }, { data: requestList }] =
    await Promise.all([
      getCustomers(businessId),
      getAssets(businessId),
      getServiceRequests(businessId),
    ]);

  return (
    <AppShell
      title="Create Repair Job"
      subheading="Initialize a workshop job ticket, link customer equipment, and schedule diagnostic triage."
    >
      <div className="mx-auto max-w-4xl">
        <Panel
          title="New Job Ticket"
          action={<StatusBadge label="New Job" tone="primary" />}
        >
          <JobForm
            customers={customerList}
            assets={assetList}
            requests={requestList}
            defaultCustomerId={defaultCustomerId}
            defaultAssetId={defaultAssetId}
            defaultRequestId={defaultRequestId}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
