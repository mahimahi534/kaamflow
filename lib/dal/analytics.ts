import { createClient } from "@/lib/supabase/server";

export interface AnalyticsMetric {
  label: string;
  value: string;
  numerator: number;
  denominator: number;
  rate: string;
  detail: string;
  sampleSize: number;
  isReliable: boolean;
}

export interface AnalyticsSummary {
  error: string | null;
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  awaitingQc: number;
  waitingParts: number;
  followUpsDue: number;
  totalCustomers: number;
  totalRequests: number;
  totalComebacks: number;
  outcomeMetrics: AnalyticsMetric[];
  statusBreakdown: { status: string; count: number }[];
}

const MIN_RELIABLE_SAMPLE = 20;

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  try {
    const supabase = await createClient();

    // Run all aggregation queries in parallel
    const [
      jobsRes,
      activeJobsRes,
      completedRes,
      qcRes,
      partsRes,
      followUpsRes,
      customersRes,
      requestsRes,
      outcomesRes,
      comebacksRes,
      statusRes,
      unknownFollowUpsRes,
    ] = await Promise.all([
      // Total jobs
      supabase.from("jobs").select("id", { count: "exact", head: true }),
      // Active jobs (not completed/closed/handover)
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .not("status", "in", '("completed","closed","handover")'),
      // Completed jobs
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["completed", "handover", "closed"]),
      // Awaiting QC
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "qc_review"),
      // Waiting for parts
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "waiting_for_parts"),
      // Follow-ups due
      supabase
        .from("follow_ups")
        .select("id", { count: "exact", head: true })
        .in("status", ["scheduled", "overdue"]),
      // Total customers
      supabase.from("customers").select("id", { count: "exact", head: true }),
      // Total requests
      supabase.from("service_requests").select("id", { count: "exact", head: true }),
      // Outcomes for metrics
      supabase.from("outcomes").select("outcome"),
      // Comeback cases
      supabase.from("comeback_cases").select("id", { count: "exact", head: true }),
      // Status breakdown
      supabase.from("jobs").select("status"),
      // Follow-ups closed as unknown after initial outreach and one reminder
      supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "unknown"),
    ]);

    const queryErrors = [
      jobsRes.error,
      activeJobsRes.error,
      completedRes.error,
      qcRes.error,
      partsRes.error,
      followUpsRes.error,
      customersRes.error,
      requestsRes.error,
      outcomesRes.error,
      comebacksRes.error,
      statusRes.error,
      unknownFollowUpsRes.error,
    ].filter(Boolean);
    if (queryErrors.length > 0) {
      throw new Error(queryErrors.map((error) => error!.message).join("; "));
    }

    const totalJobs = jobsRes.count || 0;
    const activeJobs = activeJobsRes.count || 0;
    const completedJobs = completedRes.count || 0;
    const awaitingQc = qcRes.count || 0;
    const waitingParts = partsRes.count || 0;
    const followUpsDue = followUpsRes.count || 0;
    const totalCustomers = customersRes.count || 0;
    const totalRequests = requestsRes.count || 0;
    const totalComebacks = comebacksRes.count || 0;

    // Calculate outcome metrics
    const outcomes = outcomesRes.data || [];
    const totalOutcomes = outcomes.length;
    const workingCount = outcomes.filter((o) => o.outcome === "working_as_expected").length;
    const sameSymptomCount = outcomes.filter((o) => o.outcome === "same_symptom").length;
    const legacyNoResponseCount = outcomes.filter((o) => o.outcome === "no_response").length;
    const noResponseCount = legacyNoResponseCount + (unknownFollowUpsRes.count || 0);
    const partlyCount = outcomes.filter((o) => o.outcome === "partly_improved").length;
    const differentIssueCount = outcomes.filter((o) => o.outcome === "different_issue").length;

    // Confirmed outcomes exclude no_response
    const confirmedOutcomes = totalOutcomes - legacyNoResponseCount;
    const observedOutcomes = confirmedOutcomes + noResponseCount;
    const confirmedSuccessCount = workingCount;

    // Build metrics
    const outcomeMetrics: AnalyticsMetric[] = [
      {
        label: "Confirmed Success Rate",
        value: confirmedOutcomes > 0
          ? `${((confirmedSuccessCount / confirmedOutcomes) * 100).toFixed(1)}%`
          : "—",
        numerator: confirmedSuccessCount,
        denominator: confirmedOutcomes,
        rate: confirmedOutcomes > 0
          ? `${confirmedSuccessCount}/${confirmedOutcomes}`
          : "0/0",
        detail: "WORKING outcomes ÷ customer-reported outcomes",
        sampleSize: confirmedOutcomes,
        isReliable: confirmedOutcomes >= MIN_RELIABLE_SAMPLE,
      },
      {
        label: "Same-Symptom Comeback Rate",
        value: confirmedOutcomes > 0
          ? `${((sameSymptomCount / confirmedOutcomes) * 100).toFixed(1)}%`
          : "—",
        numerator: sameSymptomCount,
        denominator: confirmedOutcomes,
        rate: confirmedOutcomes > 0 ? `${sameSymptomCount}/${confirmedOutcomes}` : "0/0",
        detail: "SAME_SYMPTOM outcomes ÷ all follow-up outcomes",
        sampleSize: confirmedOutcomes,
        isReliable: confirmedOutcomes >= MIN_RELIABLE_SAMPLE,
      },
      {
        label: "Partial Fix Rate",
        value: confirmedOutcomes > 0
          ? `${((partlyCount / confirmedOutcomes) * 100).toFixed(1)}%`
          : "—",
        numerator: partlyCount,
        denominator: confirmedOutcomes,
        rate: confirmedOutcomes > 0 ? `${partlyCount}/${confirmedOutcomes}` : "0/0",
        detail: "PARTLY outcomes ÷ confirmed responses",
        sampleSize: confirmedOutcomes,
        isReliable: confirmedOutcomes >= MIN_RELIABLE_SAMPLE,
      },
      {
        label: "Different Issue Rate",
        value: confirmedOutcomes > 0
          ? `${((differentIssueCount / confirmedOutcomes) * 100).toFixed(1)}%`
          : "—",
        numerator: differentIssueCount,
        denominator: confirmedOutcomes,
        rate: confirmedOutcomes > 0 ? `${differentIssueCount}/${confirmedOutcomes}` : "0/0",
        detail: "DIFFERENT_ISSUE outcomes ÷ confirmed responses",
        sampleSize: confirmedOutcomes,
        isReliable: confirmedOutcomes >= MIN_RELIABLE_SAMPLE,
      },
      {
        label: "Unknown Outcome Rate",
        value: observedOutcomes > 0
          ? `${((noResponseCount / observedOutcomes) * 100).toFixed(1)}%`
          : "—",
        numerator: noResponseCount,
        denominator: observedOutcomes,
        rate: observedOutcomes > 0
          ? `${noResponseCount}/${observedOutcomes}`
          : "0/0",
        detail: "NO_RESPONSE ÷ all follow-up outcomes (unreachable customers)",
        sampleSize: observedOutcomes,
        isReliable: observedOutcomes >= MIN_RELIABLE_SAMPLE,
      },
    ];

    // Status breakdown
    const statusMap = new Map<string, number>();
    for (const job of statusRes.data || []) {
      statusMap.set(job.status, (statusMap.get(job.status) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    return {
      error: null,
      totalJobs,
      activeJobs,
      completedJobs,
      awaitingQc,
      waitingParts,
      followUpsDue,
      totalCustomers,
      totalRequests,
      totalComebacks,
      outcomeMetrics,
      statusBreakdown,
    };
  } catch (err) {
    console.error("Analytics DAL error:", err);
    return {
      error: err instanceof Error ? err.message : "Could not load analytics data.",
      totalJobs: 0,
      activeJobs: 0,
      completedJobs: 0,
      awaitingQc: 0,
      waitingParts: 0,
      followUpsDue: 0,
      totalCustomers: 0,
      totalRequests: 0,
      totalComebacks: 0,
      outcomeMetrics: [],
      statusBreakdown: [],
    };
  }
}
