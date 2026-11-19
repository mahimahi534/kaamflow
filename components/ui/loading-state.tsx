export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading content" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-xl bg-slate-200"
        />
      ))}
    </div>
  );
}
