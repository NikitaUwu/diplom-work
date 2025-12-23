import React from "react";

type Variant = "info" | "danger";

const cls: Record<Variant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  danger: "border-rose-200 bg-rose-50 text-rose-900",
};

export default function Alert({
  title,
  children,
  variant = "info",
  className = "",
}: React.PropsWithChildren<{ title: string; variant?: Variant; className?: string }>) {
  return (
    <div className={`rounded-2xl border p-5 ${cls[variant]} ${className}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm opacity-90">{children}</div>
    </div>
  );
}
