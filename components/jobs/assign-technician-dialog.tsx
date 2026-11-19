"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { assignTechnicianAction } from "@/lib/actions/jobs";
import type { TechnicianSummary, Assignment } from "@/lib/types/database";

export function AssignTechnicianDialog({
  jobId,
  currentAssignment,
  technicians,
}: {
  jobId: string;
  currentAssignment?: Assignment | null;
  technicians: TechnicianSummary[];
}) {
  const [selectedTechId, setSelectedTechId] = useState<string>(
    currentAssignment?.technician_id || ""
  );
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function handleAssign() {
    if (!selectedTechId) return;
    setMessage(null);

    startTransition(async () => {
      const res = await assignTechnicianAction(jobId, selectedTechId);
      if (res.success) {
        setMessage({ text: "Technician assigned successfully." });
      } else {
        setMessage({ text: res.error || "Failed to assign technician", error: true });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={selectedTechId}
          disabled={isPending}
          onChange={(e) => setSelectedTechId(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="" disabled>
            -- Select Technician --
          </option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name} ({t.active_job_count} active {t.active_job_count === 1 ? "job" : "jobs"})
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={handleAssign}
          disabled={isPending || !selectedTechId || selectedTechId === currentAssignment?.technician_id}
          className="text-xs sm:text-sm py-2 px-3 whitespace-nowrap"
        >
          {isPending ? "Assigning..." : "Assign Crew"}
        </Button>
      </div>

      {message && (
        <p
          className={`text-xs font-medium ${
            message.error ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
