import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/server";
import { getAssetById } from "@/lib/dal/equipment";
import { getCustomers } from "@/lib/dal/customers";
import { EquipmentForm } from "@/components/equipment/equipment-form";

export default async function EditEquipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/equipment");
  const businessId = session.profile.business_id;
  const { id } = await params;

  const [{ data: asset, error }, { data: customerList }] = await Promise.all([
    getAssetById(id),
    getCustomers(businessId),
  ]);

  if (error || !asset) {
    notFound();
  }

  const titleName = [asset.brand, asset.model].filter(Boolean).join(" ") || asset.category;

  return (
    <AppShell
      title={`Edit ${titleName}`}
      subheading="Update equipment category, specifications, customer ownership, or serial number."
    >
      <div className="mx-auto max-w-3xl">
        <Panel
          title="Edit Equipment Specifications"
          action={<StatusBadge label="Updating Record" tone="warning" />}
        >
          <EquipmentForm asset={asset} customers={customerList} />
        </Panel>
      </div>
    </AppShell>
  );
}
