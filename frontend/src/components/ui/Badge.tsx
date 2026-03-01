import type { ReactNode } from "react";

export type Variant = "default" | "info" | "success" | "danger";

const cls: Record<Variant, string> = {
  default:
    "bg-slate-100 text-slate-800 ring-1 ring-slate-200 " +
    "dark:bg-slate-800/60 dark:text-slate-100 dark:ring-slate-700",
  info:
    "bg-blue-100 text-blue-800 ring-1 ring-blue-200 " +
    "dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800/50",
  success:
    "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 " +
    "dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/50",
  danger:
    "bg-rose-100 text-rose-800 ring-1 ring-rose-200 " +
    "dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800/50",
};

export default function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls[variant]} ${className}`}
    >
      {children}
    </span>
  );
}