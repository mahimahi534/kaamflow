import { createClient } from "@/lib/supabase/server";
import type { Customer, CustomerWithHistory } from "@/lib/types/database";

export interface GetCustomersOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch all customers for a given business tenant, optionally filtered by search.
 */
export async function getCustomers(
  businessId: string,
  options: GetCustomersOptions = {}
): Promise<{ data: Customer[]; totalCount: number; error: string | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("customers")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (options.search && options.search.trim()) {
      const term = options.search.trim();
      // Search in full_name, phone, email, notes
      query = query.or(
        `full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,notes.ilike.%${term}%`
      );
    }

    if (options.limit) {
      const from = options.offset || 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("Error in getCustomers DAL:", error);
      return { data: [], totalCount: 0, error: error.message };
    }

    return {
      data: (data as Customer[]) || [],
      totalCount: count || 0,
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getCustomers DAL:", err);
    return {
      data: [],
      totalCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetch a single customer by id.
 */
export async function getCustomerById(
  customerId: string
): Promise<{ data: Customer | null; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();

    if (error) {
      console.error("Error in getCustomerById DAL:", error);
      return { data: null, error: error.message };
    }

    return { data: data as Customer | null, error: null };
  } catch (err) {
    console.error("Unexpected error in getCustomerById DAL:", err);
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Fetch a customer with their assets and service requests.
 */
export async function getCustomerWithHistory(
  customerId: string
): Promise<{ data: CustomerWithHistory | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // 1. Fetch customer
    const { data: customer, error: customerErr } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();

    if (customerErr || !customer) {
      return {
        data: null,
        error: customerErr ? customerErr.message : "Customer not found",
      };
    }

    // 2. Fetch customer's assets
    const { data: assets, error: assetsErr } = await supabase
      .from("assets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (assetsErr) {
      console.warn("Could not fetch customer assets:", assetsErr);
    }

    // 3. Fetch customer's service requests
    const { data: requests, error: requestsErr } = await supabase
      .from("service_requests")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (requestsErr) {
      console.warn("Could not fetch customer service requests:", requestsErr);
    }

    return {
      data: {
        ...(customer as Customer),
        assets: (assets as CustomerWithHistory["assets"]) || [],
        service_requests: (requests as CustomerWithHistory["service_requests"]) || [],
      },
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getCustomerWithHistory DAL:", err);
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Get total customer count for a business.
 */
export async function getCustomerCount(businessId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId);

    if (error) {
      console.error("Error in getCustomerCount DAL:", error);
      return 0;
    }

    return count || 0;
  } catch {
    return 0;
  }
}
