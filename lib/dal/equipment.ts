import { createClient } from "@/lib/supabase/server";
import type { Asset, AssetWithCustomer, AssetWithHistory, Customer } from "@/lib/types/database";

export interface GetAssetsOptions {
  search?: string;
  customerId?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch assets for a business, optionally filtered by search, customer, category.
 * Includes customer details.
 */
export async function getAssets(
  businessId: string,
  options: GetAssetsOptions = {}
): Promise<{ data: AssetWithCustomer[]; totalCount: number; error: string | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("assets")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (options.customerId) {
      query = query.eq("customer_id", options.customerId);
    }

    if (options.category && options.category !== "all") {
      query = query.eq("category", options.category);
    }

    if (options.search && options.search.trim()) {
      const term = options.search.trim();
      query = query.or(
        `category.ilike.%${term}%,brand.ilike.%${term}%,model.ilike.%${term}%,serial_number.ilike.%${term}%`
      );
    }

    if (options.limit) {
      const from = options.offset || 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data: assets, count, error } = await query;

    if (error) {
      console.error("Error in getAssets DAL:", error);
      return { data: [], totalCount: 0, error: error.message };
    }

    if (!assets || assets.length === 0) {
      return { data: [], totalCount: count || 0, error: null };
    }

    // Fetch customer info for these assets
    const customerIds = Array.from(new Set(assets.map((a) => a.customer_id)));
    const customerMap = new Map<string, Pick<Customer, "id" | "full_name" | "phone" | "email">>();

    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, full_name, phone, email")
        .in("id", customerIds);

      if (customers) {
        customers.forEach((c) => customerMap.set(c.id, c));
      }
    }

    const assetsWithCustomers: AssetWithCustomer[] = assets.map((a) => ({
      ...a,
      customer: customerMap.get(a.customer_id) || null,
    }));

    return {
      data: assetsWithCustomers,
      totalCount: count || 0,
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getAssets DAL:", err);
    return {
      data: [],
      totalCount: 0,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetch a single asset with full customer details and related service requests.
 */
export async function getAssetById(
  assetId: string
): Promise<{ data: AssetWithHistory | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const { data: asset, error: assetErr } = await supabase
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .maybeSingle();

    if (assetErr || !asset) {
      return {
        data: null,
        error: assetErr ? assetErr.message : "Equipment not found",
      };
    }

    // Fetch customer
    const { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("id", asset.customer_id)
      .maybeSingle();

    // Fetch service requests linked to this asset
    const { data: requests } = await supabase
      .from("service_requests")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false });

    return {
      data: {
        ...(asset as Asset),
        customer: (customer as Customer) || null,
        service_requests: requests || [],
      },
      error: null,
    };
  } catch (err) {
    console.error("Unexpected error in getAssetById DAL:", err);
    return { data: null, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Fetch all assets belonging to a specific customer.
 */
export async function getAssetsByCustomer(customerId: string): Promise<Asset[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error in getAssetsByCustomer DAL:", error);
      return [];
    }

    return (data as Asset[]) || [];
  } catch {
    return [];
  }
}

/**
 * Get total asset count for a business.
 */
export async function getAssetCount(businessId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId);

    if (error) {
      console.error("Error in getAssetCount DAL:", error);
      return 0;
    }

    return count || 0;
  } catch {
    return 0;
  }
}
