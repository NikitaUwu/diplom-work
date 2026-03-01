import React from "react";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  right?: React.ReactNode;
};

export default function Card({
  title,
  description,
  right,
  children,
  className = "",
  ...rest
}: Props) {
  const hasHeader = Boolean(title || description || right);

  return (
    <div
      className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200
                  dark:bg-slate-900 dark:ring-slate-800 ${className}`}
      {...rest}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </div>
            )}
            {description && (
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {description}
              </div>
            )}
          </div>

          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      )}

      {children ? <div className={hasHeader ? "mt-5" : ""}>{children}</div> : null}
    </div>
  );
}