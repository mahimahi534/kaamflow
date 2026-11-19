type MetricTone = "positive" | "warning" | "neutral" | "danger" | "primary";

const toneStyles: Record<MetricTone, string> = {
  positive: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  neutral: "bg-slate-100 text-slate-700",
  danger: "bg-rose-50 text-rose-700",
  primary: "bg-blue-50 text-blue-700",
};

export function MetricCard({
  label,
  value,
  detail,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  delta?: string;
  tone?: MetricTone;
}) {
  return (
    <article className="metric-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            {value}
          </p>
          {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
        </div>
        {delta ? (
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${toneStyles[tone]}`}>
            {delta}
          </span>
        ) : null}
      </div>
    </article>
  );
}
