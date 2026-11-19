import { createClient } from "@/lib/supabase/server";
import type { TechnicianSummary, JobWithRelations, Customer, Asset, ServiceRequest } from "@/lib/types/database";

/**
 * Fetch all technicians (and owner admins) in a business with active job counts.
 */
export async function getTechnicians(
  businessId: string
): Promise<{ data: TechnicianSummary[]; error: string | null }> {
  try {
    const supabase = await createClient();

    // Fetch staff profiles that can be assigned jobs
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, avatar_url")
      .eq("business_id", businessId)
      .in("role", ["TECHNICIAN", "OWNER_ADMIN"])
      .order("full_name", { ascending: true });

    if (profErr || !profiles) {
      console.error("Error fetching technicians in DAL:", profErr);
      return { data: [], error: profErr?.message || "Failed to fetch technicians" };
    }

    // Fetch all assignments in this business to compute counts
    const { data: assignments } = await supabase
      .from("assignments")
      .select("technician_id, status")
      .eq("business_id", businessId);

    const activeCounts = new Map<string, number>();
    const completedCounts = new Map<string, number>();

    assignments?.forEach((a) => {
      if (a.status === "assigned" || a.status === "in_progress") {
        activeCounts.set(a.technician_id, (activeCounts.get(a.technician_id) || 0) + 1);
      } else if (a.status === "completed") {
        completedCounts.set(a.technician_id, (completedCounts.get(a.technician_id) || 0) + 1);
      }
    });

    const technicianSummaries: TechnicianSummary[] = profiles.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: p.role,
      avatar_url: p.avatar_url,
      active_job_count: activeCounts.get(p.id) || 0,
      completed_job_count: completedCounts.get(p.id) || 0,
    }));

    return { data: technicianSummaries, error: null };
  } catch (err) {
    console.error("Unexpected error in getTechnicians DAL:", err);
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Fetch jobs assigned to a specific technician for their workspace (/technician).
 */
export async function getTechnicianJobs(
  technicianId: string,
  businessId: string
): Promise<{ data: JobWithRelations[]; error: string | null }> {
  try {
    const supabase = await createClient();

    // 1. Fetch active assignments for this technician
    const { data: assignments, error: assignErr } = await supabase
      .from("assignments")
      .select("job_id, status, assigned_at")
      .eq("business_id", businessId)
      .eq("technician_id", technicianId)
      .in("status", ["assigned", "in_progress"])
      .order("assigned_at", { ascending: false });

    if (assignErr) {
      console.error("Error fetching technician assignments:", assignErr);
      return { data: [], error: assignErr.message };
    }

    if (!assignments || assignments.length === 0) {
      return { data: [], error: null };
    }

    const jobIds = Array.from(new Set(assignments.map((a) => a.job_id)));

    // 2. Fetch the corresponding jobs
    const { data: jobs, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .in("id", jobIds)
      .order("created_at", { ascending: false });

    if (jobErr || !jobs) {
      return { data: [], error: jobErr?.message || "Failed to load jobs" };
    }

    // 3. Enrich with customers and assets
    const customerIds = Array.from(
      new Set(jobs.map((j) => j.customer_id).filter((id): id is string => Boolean(id)))
    );
    const assetIds = Array.from(
      new Set(jobs.map((j) => j.asset_id).filter((id): id is string => Boolean(id)))
    );
    const requestIds = Array.from(
      new Set(jobs.map((j) => j.service_request_id).filter((id): id is string => Boolean(id)))
    );

    const customerMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone" | "email">>();
    const assetMap = new Map<
      string,
      Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number">
    >();
    const requestMap = new Map<string, Pick<ServiceRequest, "id" | "request_reference" | "urgency">>();

    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .in("id", customerIds);
      customers?.forEach((c) => customerMap.set(c.id, c));
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

    const enriched: JobWithRelations[] = jobs.map((j) => ({
      ...j,
      customer: j.customer_id ? customerMap.get(j.customer_id) || null : null,
      asset: j.asset_id ? assetMap.get(j.asset_id) || null : null,
      service_request: j.service_request_id ? requestMap.get(j.service_request_id) || null : null,
    }));

    return { data: enriched, error: null };
  } catch (err) {
    console.error("Unexpected error in getTechnicianJobs DAL:", err);
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}
