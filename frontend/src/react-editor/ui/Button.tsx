import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

type Props = {
  children: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 " +
    "dark:bg-blue-500 dark:hover:bg-blue-400 dark:disabled:bg-blue-700/60",
  secondary:
    "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 " +
    "dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:border-slate-800",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-400 " +
    "dark:bg-rose-500 dark:hover:bg-rose-400 dark:disabled:bg-rose-700/60",
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "primary",
  loading = false,
  className,
  type,
  disabled,
  ...rest
}: Props) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type ?? "button"}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-slate-50 dark:focus-visible:ring-slate-100/20 dark:focus-visible:ring-offset-slate-950",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
        className
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      <span>{children}</span>
    </button>
  );
}

export default Button;