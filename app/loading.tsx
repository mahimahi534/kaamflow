import { LoadingState } from "@/components/ui/loading-state";

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 flex items-center justify-center">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white animate-pulse">
            K
          </div>
          <div>
            <div className="h-4 w-32 rounded bg-slate-200 animate-pulse" />
            <div className="mt-1 h-3 w-48 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
        <LoadingState rows={4} />
      </div>
    </div>
  );
}
