"use server";

import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function generateTrackingLinkAction(
  jobId: string,
  daysValid: number = 14
): Promise<{ success: boolean; token?: string; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }
  if (!Number.isInteger(daysValid) || daysValid < 1 || daysValid > 30) {
    return { success: false, error: "Tracking links must be valid for 1 to 30 days." };
  }

  // Store only a digest; the raw bearer token is returned once for the customer link.
  const token = crypto.randomBytes(32).toString("hex");
  const tokenDigest = crypto.createHash("sha256").update(token, "utf8").digest("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysValid);

  const supabase = await createClient();

  const { error } = await supabase.rpc("create_customer_tracking_token", {
    target_job_id: jobId,
    token_digest: tokenDigest,
    token_expiry: expiresAt.toISOString(),
  });

  if (error) {
    console.error("Failed to generate customer tracking token:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true, token };
}

export async function revokeTrackingLinkAction(
  tokenId: string,
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const businessId = session.profile.business_id;

  if (!businessId) {
    return { success: false, error: "No active business tenant." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("revoke_customer_tracking_token", {
    target_token_id: tokenId,
    target_job_id: jobId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export async function getActiveTrackingTokensForJob(jobId: string) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_tracking_tokens")
    .select("id, job_id, expires_at, revoked_at, created_at")
    .eq("business_id", session.profile.business_id)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load tracking-link status: ${error.message}`);
  }

  return data || [];
}
