export type UserRole =
  | "OWNER_ADMIN"
  | "DISPATCHER"
  | "TECHNICIAN"
  | "QC_REVIEWER"
  | "CUSTOMER";

export interface UserProfile {
  id: string;
  business_id: string;
  customer_id: string | null;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionData {
  user: {
    id: string;
    email?: string;
  };
  profile: UserProfile;
  business: Business | null;
}

/**
 * Route access control matrix.
 * Lists the roles allowed to access each top-level route.
 */
export const ROUTE_ROLE_ACCESS: Record<string, UserRole[]> = {
  "/": ["OWNER_ADMIN", "DISPATCHER", "QC_REVIEWER"],
  "/jobs": ["OWNER_ADMIN", "DISPATCHER", "TECHNICIAN", "QC_REVIEWER"],
  "/requests": ["OWNER_ADMIN", "DISPATCHER"],
  "/customers": ["OWNER_ADMIN", "DISPATCHER"],
  "/equipment": ["OWNER_ADMIN", "DISPATCHER"],
  "/technicians": ["OWNER_ADMIN", "DISPATCHER"],
  "/quotations": ["OWNER_ADMIN", "DISPATCHER"],
  "/quality-control": ["OWNER_ADMIN", "DISPATCHER", "QC_REVIEWER"],
  "/fixloop": ["OWNER_ADMIN", "DISPATCHER"],
  "/analytics": ["OWNER_ADMIN", "DISPATCHER"],
  "/settings": ["OWNER_ADMIN"],
  "/technician": ["OWNER_ADMIN", "TECHNICIAN"],
  "/portal": ["OWNER_ADMIN", "CUSTOMER"],
};

/**
 * Default destination after login for each role.
 */
export const ROLE_DEFAULT_ROUTES: Record<UserRole, string> = {
  OWNER_ADMIN: "/",
  DISPATCHER: "/",
  TECHNICIAN: "/technician",
  QC_REVIEWER: "/quality-control",
  CUSTOMER: "/portal/quotes",
};

/**
 * Checks whether a role is authorized for a given pathname.
 */
export function isRouteAllowedForRole(pathname: string, role: UserRole): boolean {
  if (role === "OWNER_ADMIN") {
    return true; // Owner/Admin has global access across all staff pages
  }

  // Exact match first
  if (ROUTE_ROLE_ACCESS[pathname]) {
    return ROUTE_ROLE_ACCESS[pathname].includes(role);
  }

  // Segment match (e.g. /jobs/123 -> /jobs)
  const baseSegment = "/" + pathname.split("/").filter(Boolean)[0];
  if (ROUTE_ROLE_ACCESS[baseSegment]) {
    return ROUTE_ROLE_ACCESS[baseSegment].includes(role);
  }

  // Default deny for unmapped protected routes
  return false;
}
