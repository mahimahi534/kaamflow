"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_DEFAULT_ROUTES, isRouteAllowedForRole, type UserRole } from "./types";

export type LoginActionState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
};

export async function loginAction(
  _prevState: LoginActionState | null,
  formData: FormData
): Promise<LoginActionState> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  const requestedNext = (formData.get("next") as string | null)?.trim() ?? "";

  const fieldErrors: { email?: string; password?: string } = {};

  if (!email) {
    fieldErrors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Password is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return {
      error:
        error?.message === "Invalid login credentials"
          ? "Invalid email or password. Please verify your credentials."
          : error?.message || "Failed to sign in. Please try again.",
    };
  }

  // Look up user profile to determine legitimate landing route
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileErr) {
    console.error("Profile check error during loginAction:", profileErr);
  }

  if (!profile) {
    redirect("/pending-profile");
  }

  const userRole = profile.role as UserRole;
  let targetUrl = ROLE_DEFAULT_ROUTES[userRole] || "/";

  // If next is specified, verify that this role is allowed to access that route
  if (requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")) {
    if (isRouteAllowedForRole(requestedNext, userRole)) {
      targetUrl = requestedNext;
    }
  }

  redirect(targetUrl);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
