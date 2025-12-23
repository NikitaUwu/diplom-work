import React from "react";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  right?: React.ReactNode;
};

export default function Card({ title, description, right, children, className = "", ...rest }: Props) {
  return (
    <div
      className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 ${className}`}
      {...rest}
    >
      {(title || description || right) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && <div className="text-sm font-semibold text-slate-900">{title}</div>}
            {description && <div className="mt-1 text-sm text-slate-600">{description}</div>}
          </div>
          {right}
        </div>
      )}

      {children ? <div className={title || description || right ? "mt-5" : ""}>{children}</div> : null}
    </div>
  );
}
