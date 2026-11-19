import { createClient } from "@/lib/supabase/server";
import type { FollowUp, Outcome, ComebackCase, Job, Customer, Asset } from "@/lib/types/database";

export interface FixLoopQueueItem {
  followUp: FollowUp;
  job: Job;
  customer: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null;
  asset: Pick<Asset, "id" | "category" | "brand" | "model"> | null;
  outcome: Outcome | null;
}

export async function getFixLoopQueue(businessId: string): Promise<{
  data: FixLoopQueueItem[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    // 1. Fetch active follow-ups
    const { data: followUps, error: fuErr } = await supabase
      .from("follow_ups")
      .select("*")
      .eq("business_id", businessId)
      .order("due_at", { ascending: true });

    if (fuErr) {
      console.error("Error fetching follow-ups DAL:", fuErr);
      return { data: [], error: fuErr.message };
    }

    if (!followUps || followUps.length === 0) {
      return { data: [], error: null };
    }

    const jobIds = Array.from(new Set(followUps.map((f) => f.job_id)));
    const fuIds = followUps.map((f) => f.id);

    // 2. Fetch jobs, customers, assets, and outcomes
    const [jobsRes, outcomesRes] = await Promise.all([
      supabase.from("jobs").select("*").in("id", jobIds),
      supabase.from("outcomes").select("*").in("follow_up_id", fuIds).order("created_at", { ascending: false }),
    ]);

    const jobs = jobsRes.data || [];
    const outcomes = outcomesRes.data || [];

    const custIds = Array.from(new Set(jobs.map((j) => j.customer_id).filter(Boolean))) as string[];
    const assetIds = Array.from(new Set(jobs.map((j) => j.asset_id).filter(Boolean))) as string[];

    const [custRes, assetRes] = await Promise.all([
      custIds.length > 0
        ? supabase.from("customers").select("id, full_name, phone, email").in("id", custIds)
        : Promise.resolve({ data: [] }),
      assetIds.length > 0
        ? supabase.from("assets").select("id, category, brand, model").in("id", assetIds)
        : Promise.resolve({ data: [] }),
    ]);

    const jobMap = new Map<string, Job>();
    jobs.forEach((j) => jobMap.set(j.id, j as Job));

    const outcomeMap = new Map<string, Outcome>();
    outcomes.forEach((o) => {
      if (!outcomeMap.has(o.follow_up_id)) {
        outcomeMap.set(o.follow_up_id, o as unknown as Outcome);
      }
    });

    const custMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone" | "email">>();
    custRes.data?.forEach((c) => custMap.set(c.id, c));

    const assetMap = new Map<string, Pick<Asset, "id" | "category" | "brand" | "model">>();
    assetRes.data?.forEach((a) => assetMap.set(a.id, a));

    const items: FixLoopQueueItem[] = followUps
      .map((fu) => {
        const job = jobMap.get(fu.job_id);
        if (!job) return null;
        return {
          followUp: fu as FollowUp,
          job,
          customer: job.customer_id ? custMap.get(job.customer_id) || null : null,
          asset: job.asset_id ? assetMap.get(job.asset_id) || null : null,
          outcome: outcomeMap.get(fu.id) || null,
        };
      })
      .filter((item): item is FixLoopQueueItem => Boolean(item));

    return { data: items, error: null };
  } catch (err) {
    console.error("Unexpected error in getFixLoopQueue DAL:", err);
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getComebackCases(businessId: string): Promise<{
  data: (ComebackCase & {
    original_job?: Job | null;
    customer?: Pick<Customer, "id" | "full_name" | "phone"> | null;
  })[];
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data: cases, error } = await supabase
      .from("comeback_cases")
      .select("*, original_job:jobs!comeback_cases_original_job_id_fkey(id, issue_summary, status), customer:customers(id, full_name, phone)")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (cases as unknown as (ComebackCase & {
        original_job?: Job | null;
        customer?: Pick<Customer, "id" | "full_name" | "phone"> | null;
      })[]) || [],
      error: null,
    };
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}
