import { createClient } from "@/lib/supabase/server";
import type {
  ServiceRequest,
  ServiceRequestWithRelations,
  Customer,
  Asset,
  UrgencyLevel,
} from "@/lib/types/database";

export interface GetServiceRequestsOptions {
  search?: string;
  urgency?: UrgencyLevel | "all";
  customerId?: string;
  assetId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch service requests for a business, optionally filtered by search, urgency, customer, asset.
 * Enriches with customer and asset details.
 */
export async function getServiceRequests(
  businessId: string,
  options: GetServiceRequestsOptions = {}
): Promise<{ data: ServiceRequestWithRelations[]; totalCount: number; error: string | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("service_requests")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (options.urgency && options.urgency !== "all") {
      query = query.eq("urgency", options.urgency);
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
        `request_reference.ilike.%${term}%,customer_name.ilike.%${term}%,phone.ilike.%${term}%,equipment_category.ilike.%${term}%,brand_model.ilike.%${term}%,reported_problem.ilike.%${term}%`
      );
    }

    if (options.limit) {
      const from = options.offset || 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data: requests, count, error } = await query;

    if (error) {
      console.error("Error in getServiceRequests DAL:", error);
      return { data: [], totalCount: 0, error: error.message };
    }

    if (!requests || requests.length === 0) {
      return { data: [], totalCount: count || 0, error: null };
    }

    // Collect customer IDs and asset IDs to enrich records
    const customerIds = Array.from(
      new Set(requests.map((r) => r.customer_id).filter((id): id is string => Boolean(id)))
    );
    const assetIds = Array.from(
      new Set(requests.map((r) => r.asset_id).filter((id): id is string => Boolean(id)))
    );

    const customerMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone" | "email">>();
    const assetMap = new Map<
      string,
      Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number">
    >();

    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .in("id", customerIds);

      if (customers) {
        customers.forEach((c) => customerMap.set(c.id, c));
      }
    }

    if (assetIds.length > 0) {
      const { data: assets } = await supabase
        .from("assets")
        .select("id, category, brand, model, serial_number")
        .in("id", assetIds);

      if (assets) {
        assets.forEach((a) => assetMap.set(a.id, a));
      }
    }

    const requestsWithRelations: ServiceRequestWithRelations[] = requests.map((r) => ({
      ...r,
      customer: r.customer_id ? customerMap.get(r.customer_id) || null : null,
      asset: r.asset_id ? assetMap.get(r.asset_id) || null : null,
    }));

    return {
      data: requestsWithRelations,
      totalCount: count || 0,
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getServiceRequests DAL:", err);
    return {
      data: [],
      totalCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetch a single service request with its customer and asset details.
 */
export async function getServiceRequestById(
  requestId: string
): Promise<{ data: ServiceRequestWithRelations | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: request, error: reqErr } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (reqErr || !request) {
      return {
        data: null,
        error: reqErr ? reqErr.message : "Service request not found",
      };
    }

    let customer: Pick<Customer, "id" | "full_name" | "phone" | "email"> | null = null;
    if (request.customer_id) {
      const { data: custData } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .eq("id", request.customer_id)
        .maybeSingle();
      if (custData) customer = custData;
    }

    let asset: Pick<Asset, "id" | "category" | "brand" | "model" | "serial_number"> | null = null;
    if (request.asset_id) {
      const { data: assetData } = await supabase
        .from("assets")
        .select("id, category, brand, model, serial_number")
        .eq("id", request.asset_id)
        .maybeSingle();
      if (assetData) asset = assetData;
    }

    return {
      data: {
        ...(request as ServiceRequest),
        customer,
        asset,
      },
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getServiceRequestById DAL:", err);
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Get total service request count for a business.
 */
export async function getServiceRequestCount(
  businessId: string,
  urgency?: UrgencyLevel
): Promise<number> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("service_requests")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId);

    if (urgency) {
      query = query.eq("urgency", urgency);
    }

    const { count, error } = await query;

    if (error) {
      console.error("Error in getServiceRequestCount DAL:", error);
      return 0;
    }

    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Generates a unique, collision-free request reference (e.g., "KF-1024" or "KF-2411-XXXX").
 */
export async function generateUniqueRequestReference(): Promise<string> {
  const supabase = await createClient();

  for (let attempt = 0; attempt < 5; attempt++) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const datePrefix = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const candidate = `KF-${datePrefix}-${randomSuffix}`;

    const { data } = await supabase
      .from("service_requests")
      .select("id")
      .eq("request_reference", candidate)
      .maybeSingle();

    if (!data) {
      return candidate;
    }
  }

  // Fallback with timestamp to guarantee uniqueness
  return `KF-${Date.now().toString(36).toUpperCase()}`;
}
