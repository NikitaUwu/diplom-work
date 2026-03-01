import type { PropsWithChildren } from "react";

type Variant = "info" | "danger";

const cls: Record<Variant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100",
  danger:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
};

export default function Alert({
  title,
  children,
  variant = "info",
  className = "",
}: PropsWithChildren<{ title: string; variant?: Variant; className?: string }>) {
  const role = variant === "danger" ? "alert" : "status";
  const ariaLive = variant === "danger" ? "assertive" : "polite";

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={`rounded-2xl border p-5 ${cls[variant]} ${className}`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm opacity-90">{children}</div>
    </div>
  );
}