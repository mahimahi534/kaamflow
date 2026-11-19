"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { generateTrackingLinkAction, revokeTrackingLinkAction } from "@/lib/actions/tracking";
import type { CustomerTrackingToken } from "@/lib/types/database";

export function JobTrackingPanel({
  jobId,
  trackingTokens,
  canManage,
}: {
  jobId: string;
  trackingTokens: CustomerTrackingToken[];
  canManage: boolean;
}) {
  const tokens = trackingTokens;
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newlyGeneratedToken, setNewlyGeneratedToken] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeToken = tokens.find(
    (t) => !t.revoked_at && new Date(t.expires_at) > new Date()
  );

  function handleGenerateLink() {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await generateTrackingLinkAction(jobId, 14);
      if (res.success && res.token) {
        setNewlyGeneratedToken(res.token);
        const fullUrl = `${window.location.origin}/track/${res.token}`;
        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(fullUrl);
          }
        } catch {
          setErrorMsg("The link was created, but automatic copying failed. Copy it using the button below.");
        }
        router.refresh();
      } else {
        setErrorMsg(res.error || "Failed to generate tracking link.");
      }
    });
  }

  function handleRevoke(tokenId: string) {
    if (!confirm("Are you sure you want to revoke this tracking link? The customer will no longer be able to view repair status.")) {
      return;
    }
    setErrorMsg(null);
    startTransition(async () => {
      const res = await revokeTrackingLinkAction(tokenId, jobId);
      if (res.success) {
        setNewlyGeneratedToken(null);
        router.refresh();
      } else {
        setErrorMsg(res.error || "Failed to revoke link.");
      }
    });
  }

  async function handleCopy(token: string) {
    const fullUrl = `${window.location.origin}/track/${token}`;
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(token);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setErrorMsg("Could not copy the link. Select and copy the displayed URL manually.");
    }
  }

  return (
    <Panel
      title="Customer Tracking Link"
      action={
        <div className="flex items-center gap-2">
          {activeToken ? (
            <StatusBadge label="Link Active (14 Days)" tone="success" />
          ) : (
            <StatusBadge label="No Active Link" tone="neutral" />
          )}

          {canManage && (
            <Button
              variant="secondary"
              className="text-xs py-1 px-2.5"
              disabled={isPending}
              onClick={handleGenerateLink}
            >
              {isPending ? "Generating..." : activeToken ? "Regenerate Link" : "+ Generate Tracking Link"}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-rose-800 font-semibold">
            {errorMsg}
          </div>
        )}

        {activeToken ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="font-semibold text-blue-900">Active Public Tracking Link</p>
                {newlyGeneratedToken ? (
                  <p className="text-[11px] text-blue-700 font-mono break-all mt-0.5">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/track/${newlyGeneratedToken}`
                      : `/track/${newlyGeneratedToken}`}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-blue-700">
                    For security, the link is shown only when it is generated. Generate a replacement to copy a new link.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {newlyGeneratedToken && (
                  <button
                    type="button"
                    onClick={() => handleCopy(newlyGeneratedToken)}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    {copiedId === newlyGeneratedToken ? "✓ Copied!" : "Copy Link"}
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(activeToken.id)}
                    className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>

            <p className="text-[10px] text-slate-500 border-t border-blue-100 pt-1.5">
              Expires: {new Date(activeToken.expires_at).toLocaleDateString()} &bull; Exposes only customer-safe milestones. Never exposes internal diagnoses or private photos.
            </p>
          </div>
        ) : (
          <p className="text-slate-400 italic py-1">
            No public tracking link has been issued. Generate a link to allow the customer to check real-time repair progress without a login.
          </p>
        )}
      </div>
    </Panel>
  );
}
