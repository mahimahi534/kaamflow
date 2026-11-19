import { createClient } from "@/lib/supabase/server";
import type {
  QuoteVersion,
  QuoteStatus,
  QuoteVersionWithRelations,
  QuoteCounts,
  Job,
  Customer,
  Asset,
  Approval,
  Quote,
  JobDetailWithFullHistory,
} from "@/lib/types/database";
import { getJobById } from "./jobs";

export interface GetQuotationsOptions {
  search?: string;
  status?: QuoteStatus | "all";
  dateFrom?: string;
  dateTo?: string;
  jobId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch quotation versions for a business, with optional status, date, search, and job filters.
 * Enriches each quote version with job, customer, asset, and latest approval records.
 */
export async function getQuotations(
  businessId: string,
  options: GetQuotationsOptions = {}
): Promise<{ data: QuoteVersionWithRelations[]; totalCount: number; error: string | null }> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("quote_versions")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (options.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }

    if (options.jobId) {
      query = query.eq("job_id", options.jobId);
    }

    if (options.dateFrom) {
      query = query.gte("created_at", options.dateFrom);
    }

    if (options.dateTo) {
      // Include the entire end date
      const endOfDay = new Date(options.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.lte("created_at", endOfDay.toISOString());
    }

    if (options.limit) {
      const offset = options.offset || 0;
      query = query.range(offset, offset + options.limit - 1);
    }

    const { data: quoteRows, count, error } = await query;

    if (error) {
      console.error("Error fetching quote_versions:", error);
      return { data: [], totalCount: 0, error: error.message };
    }

    if (!quoteRows || quoteRows.length === 0) {
      return { data: [], totalCount: count || 0, error: null };
    }

    const jobIds = Array.from(new Set(quoteRows.map((q) => q.job_id).filter(Boolean)));
    const quoteVersionIds = quoteRows.map((q) => q.id);

    // Fetch related jobs in batch
    const [jobsRes, quotesRes, approvalsRes] = await Promise.all([
      jobIds.length > 0
        ? supabase
            .from("jobs")
            .select("id, issue_summary, status, customer_id, asset_id")
            .in("id", jobIds)
        : Promise.resolve({ data: [] }),
      quoteVersionIds.length > 0
        ? supabase
            .from("quotes")
            .select("*")
            .in("quote_version_id", quoteVersionIds)
        : Promise.resolve({ data: [] }),
      quoteVersionIds.length > 0
        ? supabase
            .from("approvals")
            .select("*")
            .in("quote_version_id", quoteVersionIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const jobsMap = new Map<string, Job>();
    (jobsRes.data || []).forEach((j) => jobsMap.set(j.id, j as Job));

    // Fetch customers and assets for the jobs
    const customerIds = Array.from(
      new Set(
        (jobsRes.data || [])
          .map((j) => j.customer_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const assetIds = Array.from(
      new Set(
        (jobsRes.data || [])
          .map((j) => j.asset_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const [customersRes, assetsRes] = await Promise.all([
      customerIds.length > 0
        ? supabase.from("customers").select("id, full_name, phone, email").in("id", customerIds)
        : Promise.resolve({ data: [] }),
      assetIds.length > 0
        ? supabase.from("assets").select("id, category, brand, model, serial_number").in("id", assetIds)
        : Promise.resolve({ data: [] }),
    ]);

    const customersMap = new Map<string, Customer>();
    (customersRes.data || []).forEach((c) => customersMap.set(c.id, c as Customer));

    const assetsMap = new Map<string, Asset>();
    (assetsRes.data || []).forEach((a) => assetsMap.set(a.id, a as Asset));

    const quotesMap = new Map<string, Quote>();
    (quotesRes.data || []).forEach((q) => quotesMap.set(q.quote_version_id, q as Quote));

    const approvalsMap = new Map<string, Approval[]>();
    (approvalsRes.data || []).forEach((app) => {
      const list = approvalsMap.get(app.quote_version_id) || [];
      list.push(app as Approval);
      approvalsMap.set(app.quote_version_id, list);
    });

    let enriched: QuoteVersionWithRelations[] = quoteRows.map((qv) => {
      const job = jobsMap.get(qv.job_id) || null;
      const customer = job?.customer_id ? customersMap.get(job.customer_id) || null : null;
      const asset = job?.asset_id ? assetsMap.get(job.asset_id) || null : null;

      return {
        ...(qv as QuoteVersion),
        job: job
          ? {
              id: job.id,
              issue_summary: job.issue_summary,
              status: job.status,
              customer_id: job.customer_id,
              asset_id: job.asset_id,
              customer,
              asset,
            }
          : null,
        customer,
        asset,
        approvals: approvalsMap.get(qv.id) || [],
        quote_delivery: quotesMap.get(qv.id) || null,
      };
    });

    // Client-side text search over notes, reference, customer name, asset model
    if (options.search) {
      const s = options.search.toLowerCase();
      enriched = enriched.filter(
        (q) =>
          (q.notes && q.notes.toLowerCase().includes(s)) ||
          `QT-${q.version_number}`.toLowerCase().includes(s) ||
          (q.customer && q.customer.full_name.toLowerCase().includes(s)) ||
          (q.customer && q.customer.phone && q.customer.phone.toLowerCase().includes(s)) ||
          (q.asset && q.asset.brand && q.asset.brand.toLowerCase().includes(s)) ||
          (q.asset && q.asset.model && q.asset.model.toLowerCase().includes(s)) ||
          (q.job && q.job.issue_summary.toLowerCase().includes(s))
      );
    }

    return {
      data: enriched,
      totalCount: count || enriched.length,
      error: null,
    };
  } catch (err) {
    console.error("Exception in getQuotations DAL:", err);
    return { data: [], totalCount: 0, error: "Failed to retrieve quotations" };
  }
}

/**
 * Fetch a single quote version by ID with full job, customer, asset, version history, and approvals.
 */
export async function getQuotationById(quoteVersionId: string): Promise<{
  data:
    | (QuoteVersionWithRelations & {
        all_versions: QuoteVersion[];
        job_details: JobDetailWithFullHistory | null;
      })
    | null;
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const { data: qv, error: qvErr } = await supabase
      .from("quote_versions")
      .select("*")
      .eq("id", quoteVersionId)
      .maybeSingle();

    if (qvErr || !qv) {
      return {
        data: null,
        error: qvErr ? qvErr.message : "Quotation version not found",
      };
    }

    // Parallel fetch related details
    const [allVersionsRes, deliveryRes, approvalsRes, jobDetailRes] = await Promise.all([
      supabase
        .from("quote_versions")
        .select("*")
        .eq("job_id", qv.job_id)
        .order("version_number", { ascending: false }),
      supabase
        .from("quotes")
        .select("*")
        .eq("quote_version_id", quoteVersionId)
        .maybeSingle(),
      supabase
        .from("approvals")
        .select("*")
        .eq("quote_version_id", quoteVersionId)
        .order("created_at", { ascending: false }),
      getJobById(qv.job_id),
    ]);

    const jobDetails = jobDetailRes.data;
    const customer = jobDetails?.customer || null;
    const asset = jobDetails?.asset || null;

    return {
      data: {
        ...(qv as QuoteVersion),
        job: jobDetails
          ? {
              id: jobDetails.id,
              issue_summary: jobDetails.issue_summary,
              status: jobDetails.status,
              customer_id: jobDetails.customer_id,
              asset_id: jobDetails.asset_id,
              customer,
              asset,
            }
          : null,
        customer,
        asset,
        approvals: (approvalsRes.data as Approval[]) || [],
        quote_delivery: (deliveryRes.data as Quote) || null,
        all_versions: (allVersionsRes.data as QuoteVersion[]) || [],
        job_details: jobDetails,
      },
      error: null,
    };
  } catch (err) {
    console.error("Exception in getQuotationById DAL:", err);
    return { data: null, error: "Failed to retrieve quotation details" };
  }
}

/**
 * Fetch all quote versions for a specific repair job, ordered by version_number descending.
 */
export async function getQuotationsByJob(
  jobId: string
): Promise<{ data: QuoteVersion[]; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("quote_versions")
      .select("*")
      .eq("job_id", jobId)
      .order("version_number", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data as QuoteVersion[]) || [], error: null };
  } catch (err) {
    console.error("Exception in getQuotationsByJob DAL:", err);
    return { data: [], error: "Failed to fetch quotations for job" };
  }
}

/**
 * Aggregate counts of quotations across statuses for a business.
 */
export async function getQuotationCounts(businessId: string): Promise<QuoteCounts> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("quote_versions")
      .select("status")
      .eq("business_id", businessId);

    if (error || !data) {
      return { total: 0, draft: 0, sent: 0, approved: 0, declined: 0 };
    }

    const counts: QuoteCounts = {
      total: data.length,
      draft: 0,
      sent: 0,
      approved: 0,
      declined: 0,
    };

    data.forEach((row) => {
      const st = row.status as QuoteStatus;
      if (counts[st] !== undefined) {
        counts[st]++;
      }
    });

    return counts;
  } catch (err) {
    console.error("Error in getQuotationCounts DAL:", err);
    return { total: 0, draft: 0, sent: 0, approved: 0, declined: 0 };
  }
}

/**
 * For authenticated CUSTOMER: Fetch their sent/approved/declined quotation versions.
 * Uses the security-definer RPC `public.get_my_quote_versions()` created in the core migration.
 */
export async function getMyCustomerQuotations(): Promise<{
  data: Array<{
    quote_version_id: string;
    job_id: string;
    version_number: number;
    labour_charge: number;
    parts_cost: number;
    tax_amount: number;
    total_amount: number;
    job_summary?: string;
  }>;
  error: string | null;
}> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_quote_versions");

    if (error) {
      console.error("Error calling get_my_quote_versions RPC:", error);
      return { data: [], error: error.message };
    }

    return {
      data: (data || []).map((row: {
        quote_version_id: string;
        job_id: string;
        version_number: number;
        labour_charge: number;
        parts_cost: number;
        tax_amount: number;
        total_amount: number;
      }) => ({
        ...row,
        labour_charge: Number(row.labour_charge || 0),
        parts_cost: Number(row.parts_cost || 0),
        tax_amount: Number(row.tax_amount || 0),
        total_amount: Number(row.total_amount || 0),
      })),
      error: null,
    };
  } catch (err) {
    console.error("Exception in getMyCustomerQuotations:", err);
    return { data: [], error: "Failed to fetch customer quotations" };
  }
}
