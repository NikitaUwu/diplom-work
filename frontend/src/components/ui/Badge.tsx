type Variant = "default" | "info" | "success" | "danger";

const cls: Record<Variant, string> = {
  default: "bg-slate-100 text-slate-800 ring-1 ring-slate-200",
  info: "bg-blue-100 text-blue-800 ring-1 ring-blue-200",
  success: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
  danger: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
};

export default function Badge({ children, variant = "default" }: { children: string; variant?: Variant }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls[variant]}`}>
      {children}
    </span>
  );
}
