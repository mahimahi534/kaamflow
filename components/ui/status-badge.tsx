type BadgeTone = "success" | "warning" | "danger" | "neutral" | "primary";

const toneStyles: Record<BadgeTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  primary: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
};

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${toneStyles[tone]}`}
    >
      {label}
    </span>
  );
}
