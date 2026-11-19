import { createClient } from "@/lib/supabase/server";
import type { QCRecord, Job, Asset, Customer } from "@/lib/types/database";

export interface QcQueueItem {
  job: Job;
  customer: Pick<Customer, "id" | "full_name" | "phone"> | null;
  asset: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null;
  activeTechnician: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  latestQc: QCRecord | null;
  reworkCount: number;
}

const DEFAULT_QC_CHECKLISTS: Record<string, { id: string; label: string; critical: boolean }[]> = {
  "HVAC / Cooling": [
    { id: "c1", label: "Compressor operating pressure within specification", critical: true },
    { id: "c2", label: "Refrigerant charge level and leak test passed", critical: true },
    { id: "c3", label: "Blower fan balance and amp draw verified", critical: false },
    { id: "c4", label: "Thermostat temperature differential delta-T >= 15°F", critical: true },
    { id: "c5", label: "Condensate drain line clear and free flowing", critical: false },
    { id: "c6", label: "Electrical contactors and capacitor rated microfarads inspected", critical: true },
  ],
  "Appliance": [
    { id: "r1", label: "Operating temperature reaches calibrated setpoint", critical: true },
    { id: "r2", label: "Door seals, gaskets, and hinges align without air gaps", critical: false },
    { id: "r3", label: "Electrical heating / cooling circuits tested under full cycle load", critical: true },
    { id: "r4", label: "Ground continuity and safety insulation verified (< 0.5 ohm)", critical: true },
    { id: "r5", label: "No abnormal vibration, rattles, or loose mounting hardware", critical: false },
  ],
  "Washing Machine": [
    { id: "w1", label: "Water fill level pressure switch triggers accurately", critical: true },
    { id: "w2", label: "High-speed spin cycle tested without excessive vibration", critical: true },
    { id: "w3", label: "Drain pump evacuation time under 90 seconds", critical: false },
    { id: "w4", label: "Lid switch / door interlock safety lock verified", critical: true },
    { id: "w5", label: "No water leaks around tub seal, hoses, or pump", critical: true },
  ],
  "Electronics": [
    { id: "e1", label: "Power supply rail voltages verified under rated operating load", critical: true },
    { id: "e2", label: "Primary functionality and controls cycle without intermittent dropouts", critical: true },
    { id: "e3", label: "Thermal dissipation and heat sinks stay within safe limits (< 75°C)", critical: false },
    { id: "e4", label: "All chassis screws, shielding, and safety grounding reinstalled", critical: true },
    { id: "e5", label: "Firmware / display output tested for clear diagnostic status", critical: false },
  ],
};

export async function getQcQueue(businessId: string): Promise<{
  data: QcQueueItem[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    // Fetch jobs that are currently awaiting QC review or were recently inspected
    const { data: jobs, error: jobsErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("business_id", businessId)
      .in("status", ["qc_review", "in_progress", "completed", "handover"])
      .order("updated_at", { ascending: false });

    if (jobsErr) {
      console.error("Error fetching QC queue jobs:", jobsErr);
      return { data: [], error: jobsErr.message };
    }

    if (!jobs || jobs.length === 0) {
      return { data: [], error: null };
    }

    const jobIds = jobs.map((j) => j.id);
    const customerIds = Array.from(new Set(jobs.map((j) => j.customer_id).filter(Boolean))) as string[];
    const assetIds = Array.from(new Set(jobs.map((j) => j.asset_id).filter(Boolean))) as string[];

    // Parallel fetch related customers, assets, assignments, and QC records
    const [custRes, assetRes, assignRes, qcRes] = await Promise.all([
      customerIds.length > 0
        ? supabase.from("customers").select("id, full_name, phone").in("id", customerIds)
        : Promise.resolve({ data: [] }),
      assetIds.length > 0
        ? supabase.from("assets").select("id, category, brand, model, serial_number").in("id", assetIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("assignments")
        .select("job_id, status, technician:profiles!assignments_technician_id_fkey(id, full_name, email)")
        .in("job_id", jobIds)
        .in("status", ["assigned", "in_progress"]),
      supabase
        .from("qc_records")
        .select("*, reviewer:profiles!qc_records_reviewer_id_fkey(id, full_name, email)")
        .in("job_id", jobIds)
        .order("created_at", { ascending: false }),
    ]);

    const custMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone">>();
    custRes.data?.forEach((c) => custMap.set(c.id, c));

    const assetMap = new Map<string, Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number">>();
    assetRes.data?.forEach((a) => assetMap.set(a.id, a));

    const assignMap = new Map<string, { id: string; full_name: string; email: string }>();
    assignRes.data?.forEach((a) => {
      if (a.technician) {
        assignMap.set(a.job_id, a.technician as unknown as { id: string; full_name: string; email: string });
      }
    });

    const latestQcMap = new Map<string, QCRecord>();
    qcRes.data?.forEach((q) => {
      if (!latestQcMap.has(q.job_id)) {
        latestQcMap.set(q.job_id, q as unknown as QCRecord);
      }
    });

    const items: QcQueueItem[] = jobs.map((job) => ({
      job: job as Job,
      customer: job.customer_id ? custMap.get(job.customer_id) || null : null,
      asset: job.asset_id ? assetMap.get(job.asset_id) || null : null,
      activeTechnician: assignMap.get(job.id) || null,
      latestQc: latestQcMap.get(job.id) || null,
      reworkCount: (job as { rework_count?: number | null }).rework_count ?? 0,
    }));

    // Filter to jobs that are in qc_review OR have a QC record
    const queue = items.filter((item) => item.job.status === "qc_review" || item.latestQc !== null);

    return { data: queue, error: null };
  } catch (err) {
    console.error("Unexpected error in getQcQueue DAL:", err);
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getJobQcHistory(jobId: string): Promise<{
  data: QCRecord[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("qc_records")
      .select("*, reviewer:profiles!qc_records_reviewer_id_fkey(id, full_name, email)")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data as unknown as QCRecord[]) || [], error: null };
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getCategoryQcChecklist(
  businessId: string,
  category: string
): Promise<{ id: string; label: string; critical: boolean }[]> {
  try {
    const supabase = await createClient();

    const { data } = await supabase
      .from("checklist_templates")
      .select("items")
      .eq("business_id", businessId)
      .eq("category", category)
      .eq("type", "qc")
      .maybeSingle();

    if (data?.items && Array.isArray(data.items) && data.items.length > 0) {
      return data.items;
    }
  } catch {
    // Fall back to built-in templates
  }

  // Fallback matching category
  if (category.toLowerCase().includes("hvac") || category.toLowerCase().includes("cool") || category.toLowerCase().includes("ac")) {
    return DEFAULT_QC_CHECKLISTS["HVAC / Cooling"];
  }
  if (category.toLowerCase().includes("wash")) {
    return DEFAULT_QC_CHECKLISTS["Washing Machine"];
  }
  if (category.toLowerCase().includes("phone") || category.toLowerCase().includes("laptop") || category.toLowerCase().includes("audio") || category.toLowerCase().includes("tv") || category.toLowerCase().includes("electronics")) {
    return DEFAULT_QC_CHECKLISTS["Electronics"];
  }
  return DEFAULT_QC_CHECKLISTS["Appliance"];
}
