"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { toggleTeamMemberStatusAction, updateTeamMemberRoleAction } from "@/lib/actions/settings";
import type { TeamMember } from "@/lib/dal/settings";

const ROLE_LABELS: Record<string, string> = {
  OWNER_ADMIN: "Owner / Admin",
  DISPATCHER: "Service Desk / Dispatcher",
  TECHNICIAN: "Bench Technician",
  QC_REVIEWER: "QC Inspector",
};

const ROLE_COLORS: Record<string, string> = {
  OWNER_ADMIN: "bg-purple-100 text-purple-800",
  DISPATCHER: "bg-blue-100 text-blue-800",
  TECHNICIAN: "bg-emerald-100 text-emerald-800",
  QC_REVIEWER: "bg-amber-100 text-amber-800",
};

export function TeamMemberList({
  members,
  currentUserId,
}: {
  members: TeamMember[];
  currentUserId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleToggleStatus(profileId: string, isActive: boolean) {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await toggleTeamMemberStatusAction(profileId, isActive);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to update status.");
      }
    });
  }

  function handleRoleChange(profileId: string, newRole: string) {
    setErrorMsg(null);
    startTransition(async () => {
      const res = await updateTeamMemberRoleAction(profileId, newRole);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to update role.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-semibold">
          {errorMsg}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {members.map((m) => {
          const isSelf = m.id === currentUserId;
          return (
            <div
              key={m.id}
              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3 ${
                m.is_active === false ? "opacity-50 bg-slate-50" : ""
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">{m.full_name}</span>
                  {isSelf && (
                    <span className="text-[10px] rounded bg-slate-200 px-1.5 py-0.5 font-bold text-slate-600">
                      YOU
                    </span>
                  )}
                  {m.is_active === false && (
                    <StatusBadge label="Deactivated" tone="danger" />
                  )}
                </div>
                <p className="text-xs text-slate-500">{m.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${ROLE_COLORS[m.role] || "bg-slate-100 text-slate-700"}`}>
                    {ROLE_LABELS[m.role] || m.role}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Joined {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {!isSelf && (
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={m.role}
                    disabled={isPending}
                    onChange={(e) => handleRoleChange(m.id, e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 bg-white outline-none focus:border-blue-500"
                  >
                    <option value="OWNER_ADMIN">Owner / Admin</option>
                    <option value="DISPATCHER">Dispatcher</option>
                    <option value="TECHNICIAN">Technician</option>
                    <option value="QC_REVIEWER">QC Reviewer</option>
                  </select>

                  {m.is_active !== false ? (
                    <Button
                      variant="secondary"
                      className="text-[11px] py-1 px-2 text-rose-600 hover:bg-rose-50"
                      disabled={isPending}
                      onClick={() => handleToggleStatus(m.id, false)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      className="text-[11px] py-1 px-2 text-emerald-600 hover:bg-emerald-50"
                      disabled={isPending}
                      onClick={() => handleToggleStatus(m.id, true)}
                    >
                      Reactivate
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
