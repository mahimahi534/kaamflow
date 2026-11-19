import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/auth/server";
import type {
  Job,
  JobStatus,
  JobWithRelations,
  JobDetailWithFullHistory,
  Customer,
  Asset,
  ServiceRequest,
  Assignment,
  Diagnosis,
  RepairLog,
  PartUsed,
} from "@/lib/types/database";

export function maskPhoneNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "(•••) •••-•••• [Protected]";
  const last2 = digits.slice(-2);
  return `(•••) •••-••${last2} [Protected]`;
}

export interface GetJobsOptions {
  search?: string;
  status?: JobStatus | "all" | "active";
  customerId?: string;
  assetId?: string;
  limit?: number;
  offset?: number;
}

const ACTIVE_STATUSES: JobStatus[] = [
  "new_request",
  "intake",
  "diagnosis",
  "quotation",
  "awaiting_customer_approval",
  "assigned",
  "in_progress",
  "waiting_for_parts",
  "qc_review",
];

/**
 * Fetch jobs for a business, optionally filtered by status, search term, customer, asset.
 * Includes customer, asset, service_request, and current active technician assignment.
 */
export async function getJobs(
  businessId: string,
  options: GetJobsOptions = {}
): Promise<{ data: JobWithRelations[]; totalCount: number; error: string | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (options.status === "active") {
      query = query.in("status", ACTIVE_STATUSES);
    } else if (options.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }

    if (options.customerId) {
      query = query.eq("customer_id", options.customerId);
    }

    if (options.assetId) {
      query = query.eq("asset_id", options.assetId);
    }

    if (options.search && options.search.trim()) {
      const term = options.search.trim();
      query = query.or(
        `issue_summary.ilike.%${term}%,diagnosis_notes.ilike.%${term}%`
      );
    }

    if (options.limit) {
      const from = options.offset || 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data: jobs, count, error } = await query;

    if (error) {
      console.error("Error in getJobs DAL:", error);
      return { data: [], totalCount: 0, error: error.message };
    }

    if (!jobs || jobs.length === 0) {
      return { data: [], totalCount: count || 0, error: null };
    }

    // Collect related foreign keys to enrich records
    const customerIds = Array.from(
      new Set(jobs.map((j) => j.customer_id).filter((id): id is string => Boolean(id)))
    );
    const assetIds = Array.from(
      new Set(jobs.map((j) => j.asset_id).filter((id): id is string => Boolean(id)))
    );
    const requestIds = Array.from(
      new Set(jobs.map((j) => j.service_request_id).filter((id): id is string => Boolean(id)))
    );
    const jobIds = jobs.map((j) => j.id);

    const customerMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone" | "email">>();
    const assetMap = new Map<
      string,
      Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number">
    >();
    const requestMap = new Map<string, Pick<ServiceRequest, "id" | "request_reference" | "urgency">>();
    const assignmentMap = new Map<string, Assignment>();

    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .in("id", customerIds);
      
      const session = await getAuthSession();
      const isTechnician = session?.profile?.role === "TECHNICIAN";

      customers?.forEach((c) => {
        customerMap.set(c.id, {
          ...c,
          phone: isTechnician ? maskPhoneNumber(c.phone) : c.phone,
        });
      });
    }

    if (assetIds.length > 0) {
      const { data: assets } = await supabase
        .from("assets")
        .select("id, category, brand, model, serial_number")
        .in("id", assetIds);
      assets?.forEach((a) => assetMap.set(a.id, a));
    }

    if (requestIds.length > 0) {
      const { data: reqs } = await supabase
        .from("service_requests")
        .select("id, request_reference, urgency")
        .in("id", requestIds);
      reqs?.forEach((r) => requestMap.set(r.id, r));
    }

    // Fetch active assignments for these jobs
    if (jobIds.length > 0) {
      const { data: assignments } = await supabase
        .from("assignments")
        .select("*, technician:profiles!assignments_technician_id_fkey(id, full_name, email)")
        .in("job_id", jobIds)
        .in("status", ["assigned", "in_progress"])
        .order("assigned_at", { ascending: false });

      assignments?.forEach((a) => {
        // Keep the latest active assignment per job
        if (!assignmentMap.has(a.job_id)) {
          assignmentMap.set(a.job_id, a as unknown as Assignment);
        }
      });
    }

    const jobsWithRelations: JobWithRelations[] = jobs.map((j) => ({
      ...j,
      customer: j.customer_id ? customerMap.get(j.customer_id) || null : null,
      asset: j.asset_id ? assetMap.get(j.asset_id) || null : null,
      service_request: j.service_request_id ? requestMap.get(j.service_request_id) || null : null,
      active_assignment: assignmentMap.get(j.id) || null,
    }));

    return {
      data: jobsWithRelations,
      totalCount: count || 0,
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getJobs DAL:", err);
    return {
      data: [],
      totalCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetch a single job with all related entities:
 * Customer, Asset, Service Request, Assignments, Diagnoses, Repair Logs, Parts Used.
 */
export async function getJobById(
  jobId: string
): Promise<{ data: JobDetailWithFullHistory | null; error: string | null }> {
  try {
    const supabase = await createClient();
    const session = await getAuthSession();
    const isTechnician = session?.profile?.role === "TECHNICIAN";
    const canViewFinancials =
      session?.profile?.role === "OWNER_ADMIN" || session?.profile?.role === "DISPATCHER";

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobErr || !job) {
      return {
        data: null,
        error: jobErr ? jobErr.message : "Repair job not found",
      };
    }

    // Parallel fetch related details
    const [
      customerRes,
      assetRes,
      requestRes,
      assignmentsRes,
      diagnosesRes,
      repairLogsRes,
    ] = await Promise.all([
      job.customer_id
        ? supabase.from("customers").select("id, full_name, phone, email").eq("id", job.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      job.asset_id
        ? supabase.from("assets").select("id, category, brand, model, serial_number").eq("id", job.asset_id).maybeSingle()
        : Promise.resolve({ data: null }),
      job.service_request_id
        ? supabase.from("service_requests").select("id, request_reference, urgency").eq("id", job.service_request_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("assignments")
        .select(
          isTechnician
            ? "*, technician:profiles!assignments_technician_id_fkey(id, full_name), assigner:profiles!assignments_assigned_by_fkey(id, full_name)"
            : "*, technician:profiles!assignments_technician_id_fkey(id, full_name, email), assigner:profiles!assignments_assigned_by_fkey(id, full_name)"
        )
        .eq("job_id", jobId)
        .order("assigned_at", { ascending: false }),
      supabase
        .from("diagnoses")
        .select(
          isTechnician
            ? "*, technician:profiles(id, full_name)"
            : "*, technician:profiles(id, full_name, email)"
        )
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("repair_logs")
        .select("*, technician:profiles(id, full_name)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
    ]);

    let partsUsed: PartUsed[];
    if (!canViewFinancials) {
      const { data, error } = await supabase
        .from("parts_used")
        .select("id, business_id, job_id, part_name, part_number, quantity, used_at")
        .eq("job_id", jobId)
        .order("used_at", { ascending: false });
      if (error) throw new Error(`Could not load parts used: ${error.message}`);
      partsUsed = (data || []).map((part) => ({ ...part, unit_cost: null }));
    } else {
      const { data, error } = await supabase.rpc("get_financial_parts_used", {
        target_job_id: jobId,
      });
      if (error) throw new Error(`Could not load parts used: ${error.message}`);
      const financialParts = data as PartUsed[] | null;
      partsUsed = (financialParts || []).map((part) => ({
        ...part,
        unit_cost: Number(part.unit_cost),
      }));
    }

    const assignments = (assignmentsRes.data as unknown as Assignment[]) || [];
    const activeAssignment = assignments.find((a) => a.status === "assigned" || a.status === "in_progress") || null;

    let customer = (customerRes.data as Customer) || null;
    if (customer && isTechnician) {
      customer = {
        ...customer,
        phone: maskPhoneNumber(customer.phone),
        email: null,
      };
    }

    return {
      data: {
        ...(job as Job),
        customer,
        asset: (assetRes.data as Asset) || null,
        service_request: (requestRes.data as ServiceRequest) || null,
        active_assignment: activeAssignment,
        assignments,
        diagnoses: (diagnosesRes.data as unknown as Diagnosis[]) || [],
        repair_logs: (repairLogsRes.data as unknown as RepairLog[]) || [],
        parts_used: partsUsed,
      },
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getJobById DAL:", err);
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Get aggregated counts of jobs for dashboard metrics and filter badges.
 */
export async function getJobCounts(businessId: string): Promise<{
  total: number;
  active: number;
  inProgress: number;
  awaitingApproval: number;
  waitingParts: number;
  qcReview: number;
  completed: number;
}> {
  try {
    const supabase = await createClient();

    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("status")
      .eq("business_id", businessId);

    if (error || !jobs) {
      return {
        total: 0,
        active: 0,
        inProgress: 0,
        awaitingApproval: 0,
        waitingParts: 0,
        qcReview: 0,
        completed: 0,
      };
    }

    const counts = {
      total: jobs.length,
      active: 0,
      inProgress: 0,
      awaitingApproval: 0,
      waitingParts: 0,
      qcReview: 0,
      completed: 0,
    };

    jobs.forEach((j) => {
      const s = j.status as JobStatus;
      if (ACTIVE_STATUSES.includes(s)) counts.active++;
      if (s === "in_progress") counts.inProgress++;
      if (s === "awaiting_customer_approval") counts.awaitingApproval++;
      if (s === "waiting_for_parts") counts.waitingParts++;
      if (s === "qc_review") counts.qcReview++;
      if (s === "completed" || s === "handover" || s === "closed") counts.completed++;
    });

    return counts;
  } catch {
    return {
      total: 0,
      active: 0,
      inProgress: 0,
      awaitingApproval: 0,
      waitingParts: 0,
      qcReview: 0,
      completed: 0,
    };
  }
}

/**
 * Fetch all jobs for a specific customer.
 */
export async function getJobsByCustomer(customerId: string): Promise<Job[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data as Job[]) || [];
  } catch {
    return [];
  }
}

/**
 * Fetch all jobs for a specific asset.
 */
export async function getJobsByAsset(assetId: string): Promise<Job[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data as Job[]) || [];
  } catch {
    return [];
  }
}
