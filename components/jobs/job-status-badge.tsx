import { StatusBadge } from "@/components/ui/status-badge";
import type { JobStatus } from "@/lib/types/database";

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; tone: "primary" | "success" | "warning" | "danger" | "neutral" }
> = {
  new_request: { label: "New Request", tone: "neutral" },
  intake: { label: "Intake", tone: "primary" },
  diagnosis: { label: "In Diagnosis", tone: "primary" },
  quotation: { label: "Quotation", tone: "warning" },
  awaiting_customer_approval: { label: "Awaiting Approval", tone: "warning" },
  assigned: { label: "Assigned", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "success" },
  waiting_for_parts: { label: "Waiting for Parts", tone: "warning" },
  qc_review: { label: "QC Review", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  handover: { label: "Ready for Handover", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const config = STATUS_CONFIG[status] || { label: status, tone: "neutral" };
  return <StatusBadge label={config.label} tone={config.tone} />;
}
