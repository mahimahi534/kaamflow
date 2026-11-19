import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthSessionData, UserProfile, Business, UserRole } from "./types";
import { isRouteAllowedForRole } from "./types";

/**
 * Retrieves the current authenticated session, profile, and business.
 * Cached per request using React cache() to eliminate duplicate database hits.
 */
export const getAuthSession = cache(async (): Promise<AuthSessionData | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  // 1. Fetch profile record directly by primary key (id = auth.uid())
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, business_id, customer_id, email, full_name, role, avatar_url, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Database error fetching profile in getAuthSession:", profileError);
  }

  if (!profile) {
    // Auth user exists, but profile has not been provisioned in public.profiles yet
    return {
      user: {
        id: user.id,
        email: user.email,
      },
      profile: null as unknown as UserProfile,
      business: null,
    };
  }

  // 2. Fetch associated business tenant details
  let business: Business | null = null;
  if (profile.business_id) {
    const { data: bizData, error: bizError } = await supabase
      .from("businesses")
      .select("id, name, slug, created_at, updated_at")
      .eq("id", profile.business_id)
      .maybeSingle();

    if (bizError) {
      console.warn("Could not fetch business tenant details:", bizError);
    } else if (bizData) {
      business = bizData as Business;
    }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile: {
      id: profile.id,
      business_id: profile.business_id,
      customer_id: profile.customer_id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role as UserRole,
      avatar_url: profile.avatar_url,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    },
    business,
  };
});

/**
 * Server guard: requires the user to be logged in and have an active profile.
 * Redirects unauthenticated users to /login.
 * Redirects users with missing profiles to /pending-profile.
 */
export async function requireAuth(returnTo?: string): Promise<AuthSessionData> {
  const session = await getAuthSession();

  if (!session || !session.user) {
    const nextParam = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${nextParam}`);
  }

  if (!session.profile) {
    redirect("/pending-profile");
  }

  return session;
}

/**
 * Server guard: requires the user to have one of the allowed roles.
 * Never trusts client headers or cookies; enforces role from the database.
 */
export async function requireRole(
  allowedRoles: UserRole[],
  pathname?: string
): Promise<AuthSessionData> {
  const session = await requireAuth(pathname);

  if (session.profile.role === "OWNER_ADMIN") {
    return session; // OWNER_ADMIN has universal access
  }

  if (!allowedRoles.includes(session.profile.role)) {
    redirect(`/unauthorized?required=${allowedRoles.join(",")}&current=${session.profile.role}`);
  }

  return session;
}

/**
 * Server guard: verifies access for a specific pathname based on the access matrix.
 */
export async function requireRouteAccess(pathname: string): Promise<AuthSessionData> {
  const session = await requireAuth(pathname);

  if (!isRouteAllowedForRole(pathname, session.profile.role)) {
    redirect(`/unauthorized?path=${encodeURIComponent(pathname)}&current=${session.profile.role}`);
  }

  return session;
}
