"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function PartsWaitingDialog({
  jobId,
  onOrderRecorded,
}: {
  jobId: string;
  onOrderRecorded?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [partName, setPartName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    // Call server action to record parts order
    const { recordPartsOrderAction } = await import("@/lib/actions/jobs");

    startTransition(async () => {
      const res = await recordPartsOrderAction({
        jobId,
        partName: partName.trim(),
        supplier: supplier.trim() || undefined,
        arrivalDate: arrivalDate || undefined,
        customerVisibleNote: customerNote.trim() || undefined,
      });

      if (res.success) {
        setIsOpen(false);
        setPartName("");
        setSupplier("");
        setCustomerNote("");
        onOrderRecorded?.();
      } else {
        setErrorMsg(res.error || "Failed to record parts order.");
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        className="text-xs py-1.5 px-3"
        onClick={() => setIsOpen(true)}
      >
        + Record Parts on Order
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
                  Procurement Tracking
                </span>
                <h3 className="text-base font-bold text-slate-900">Waiting-for-Parts Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-600">Part Description *</label>
                <input
                  type="text"
                  required
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  placeholder="e.g. Inverter control PCB board #DA92-0048"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-600">Supplier / Source</label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="e.g. Authorized Distributor / Samsung OEM"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-600">Expected Arrival Date</label>
                  <input
                    type="date"
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-600">
                  Customer-Visible Status Update
                </label>
                <textarea
                  rows={2}
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                  placeholder="e.g. Replacement inverter board ordered from central warehouse; shipment expected Friday."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
                <p className="text-[10px] text-slate-400">
                  This note will be visible to the customer on their live tracking link.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs py-2 px-3"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || !partName.trim()}
                  className="text-xs py-2 px-4 bg-amber-600 hover:bg-amber-700"
                >
                  {isPending ? "Recording Order..." : "Record Part Order"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
