import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/types";

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BusinessSettings {
  id: string;
  name: string;
  slug: string;
  operating_hours: string | null;
  service_categories: string[] | null;
  coverage_notes: string | null;
  follow_up_interval_days: number | null;
  observation_window_days: number | null;
  min_sample_size: number | null;
  status_labels: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .maybeSingle();
    return data as BusinessSettings | null;
  } catch {
    return null;
  }
}

export async function getTeamMembers(businessId: string): Promise<TeamMember[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, avatar_url, is_active, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    return (data as TeamMember[]) || [];
  } catch {
    return [];
  }
}
