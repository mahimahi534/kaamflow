export interface Customer {
  id: string;
  business_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  business_id: string;
  customer_id: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  created_at: string;
  updated_at: string;
}

export type UrgencyLevel = "low" | "medium" | "high" | "urgent";

export interface ServiceRequest {
  id: string;
  business_id: string;
  customer_id: string | null;
  asset_id: string | null;
  source_follow_up_id: string | null;
  customer_name: string;
  customer_email?: string | null;
  phone: string;
  equipment_category: string;
  brand_model: string;
  reported_problem: string;
  urgency: UrgencyLevel;
  preferred_appointment: string | null;
  request_reference: string;
  privacy_consent: boolean;
  submitted_by_customer?: boolean;
  service_address?: string | null;
  visible_condition?: string | null;
  accessories_supplied?: string | null;
  access_notes?: string | null;
  appointment_status?: "pending" | "confirmed" | "rescheduled" | "cancelled";
  appointment_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AssetWithCustomer extends Asset {
  customer?: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
}

export interface ServiceRequestWithRelations extends ServiceRequest {
  customer?: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
  asset?: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null;
}

export interface CustomerWithHistory extends Customer {
  assets: Asset[];
  service_requests: ServiceRequest[];
}

export interface AssetWithHistory extends Asset {
  customer: Customer | null;
  service_requests: ServiceRequest[];
}

export type JobStatus =
  | "new_request"
  | "intake"
  | "diagnosis"
  | "quotation"
  | "awaiting_customer_approval"
  | "assigned"
  | "in_progress"
  | "waiting_for_parts"
  | "qc_review"
  | "completed"
  | "handover"
  | "closed";

export interface Job {
  id: string;
  business_id: string;
  service_request_id: string | null;
  customer_id: string | null;
  asset_id: string | null;
  status: JobStatus;
  issue_summary: string;
  diagnosis_notes: string | null;
  handed_over_at: string | null;
  quote_required?: boolean;
  quote_approved_at?: string | null;
  qc_passed_at?: string | null;
  qc_override_reason?: string | null;
  qc_override_by?: string | null;
  rework_count?: number;
  rework_notes?: string | null;
  is_rework?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Diagnosis {
  id: string;
  business_id: string;
  job_id: string;
  technician_id: string | null;
  notes: string;
  root_cause: string | null;
  created_at: string;
  updated_at: string;
  technician?: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

export type AssignmentStatus = "assigned" | "in_progress" | "completed" | "cancelled";

export interface Assignment {
  id: string;
  business_id: string;
  job_id: string;
  technician_id: string;
  assigned_by: string | null;
  assigned_at: string;
  status: AssignmentStatus;
  technician?: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  assigner?: {
    id: string;
    full_name: string;
  } | null;
}

export interface RepairLog {
  id: string;
  business_id: string;
  job_id: string;
  technician_id: string | null;
  action: string;
  notes: string | null;
  created_at: string;
  technician?: {
    id: string;
    full_name: string;
  } | null;
}

export interface PartUsed {
  id: string;
  business_id: string;
  job_id: string;
  part_name: string;
  part_number: string | null;
  quantity: number;
  unit_cost: number | null;
  used_at: string;
}

export interface JobWithRelations extends Job {
  customer?: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
  asset?: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null;
  service_request?: Pick<ServiceRequest, "id" | "request_reference" | "urgency"> | null;
  active_assignment?: Assignment | null;
}

export interface JobDetailWithFullHistory extends JobWithRelations {
  assignments: Assignment[];
  diagnoses: Diagnosis[];
  repair_logs: RepairLog[];
  parts_used: PartUsed[];
}

export interface TechnicianSummary {
  id: string;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  active_job_count: number;
  completed_job_count: number;
}

export type QuoteStatus = "draft" | "sent" | "approved" | "declined";

export type ApprovalStatus = "pending" | "approved" | "declined" | "expired";

export interface QuoteVersion {
  id: string;
  business_id: string;
  job_id: string;
  version_number: number;
  labour_charge: number;
  parts_cost: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
  status: QuoteStatus;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  business_id: string;
  job_id: string;
  quote_version_id: string;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  business_id: string;
  quote_version_id: string;
  customer_id: string;
  status: ApprovalStatus;
  approved_at: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteVersionWithRelations extends QuoteVersion {
  job?: (Pick<Job, "id" | "issue_summary" | "status" | "customer_id" | "asset_id"> & {
    customer?: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
    asset?: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null;
  }) | null;
  customer?: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
  asset?: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null;
  approvals?: Approval[];
  quote_delivery?: Quote | null;
}

export interface QuoteCounts {
  total: number;
  draft: number;
  sent: number;
  approved: number;
  declined: number;
}

export interface QCRecord {
  id: string;
  business_id: string;
  job_id: string;
  reviewer_id: string | null;
  passed: boolean;
  checklist: Record<string, boolean> | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
  reviewer?: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

export type PaymentStatus = "pending" | "paid" | "partially_paid" | "waived";

export interface Invoice {
  id: string;
  business_id: string;
  job_id: string;
  quote_version_id: string | null;
  invoice_number: string;
  total_amount: number;
  payment_status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface WarrantyTerm {
  id: string;
  business_id: string;
  job_id: string;
  warranty_period_days: number;
  terms: string;
  created_at: string;
  updated_at: string;
}

export type FollowUpStatus = "scheduled" | "sent" | "completed" | "overdue" | "unknown";

export interface FollowUp {
  id: string;
  business_id: string;
  job_id: string;
  due_at: string;
  response_deadline: string | null;
  status: FollowUpStatus;
  created_at: string;
  updated_at: string;
}

export type RepairOutcome =
  | "working_as_expected"
  | "same_symptom"
  | "partly_improved"
  | "different_issue"
  | "no_response";
export type StaffReportedOutcome = "working" | "same_symptom" | "partly" | "different_issue" | "no_response";

export interface Outcome {
  id: string;
  business_id: string;
  follow_up_id: string;
  customer_id: string;
  outcome: RepairOutcome;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ComebackStatus = "needs_review" | "open" | "in_progress" | "resolved" | "closed";

export interface ComebackCase {
  id: string;
  business_id: string;
  original_job_id: string;
  customer_id: string;
  issue_summary: string;
  linked_follow_up_id: string | null;
  status: ComebackStatus;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  business_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "mobile_pay" | "other";

export interface Payment {
  id: string;
  business_id: string;
  job_id: string;
  invoice_id: string | null;
  amount: number;
  payment_method: PaymentMethod;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  recorder?: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

export interface CustomerTrackingToken {
  id: string;
  job_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export type ComplaintStatus = "open" | "under_review" | "resolved" | "dismissed";

export interface Complaint {
  id: string;
  business_id: string;
  job_id: string;
  customer_id: string | null;
  complaint_text: string;
  status: ComplaintStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PartsOrderStatus = "ordered" | "shipped" | "received" | "cancelled";

export interface PartsOrder {
  id: string;
  business_id: string;
  job_id: string;
  part_name: string;
  part_number: string | null;
  supplier: string | null;
  quantity: number;
  status: PartsOrderStatus;
  expected_arrival_date: string | null;
  customer_visible_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  critical: boolean;
}

export interface ChecklistTemplate {
  id: string;
  business_id: string;
  category: string;
  type: "diagnosis" | "qc";
  items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}


