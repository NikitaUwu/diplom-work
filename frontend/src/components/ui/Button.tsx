import React from "react";

type Variant = "primary" | "secondary" | "danger";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition " +
  "focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-900",
  secondary: "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 focus:ring-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-500 focus:ring-rose-600",
};

function SpinnerSmall() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

export default function Button({ variant = "primary", loading, children, ...rest }: Props) {
  return (
    <button className={`${base} ${variants[variant]}`} {...rest}>
      {loading ? <SpinnerSmall /> : null}
      {children}
    </button>
  );
}
