import { useEffect, useId, useRef, useState } from "react";
import Button, { type ButtonVariant } from "./Button";

export type DropdownItem = {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

type Props = {
  label: string;
  items: DropdownItem[];
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function DropdownButton({
  label,
  items,
  variant = "secondary",
  disabled = false,
  className,
  align = "right",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open) return;
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuAlign = align === "right" ? "right-0" : "left-0";

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <Button
        variant={variant}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="inline-flex items-center gap-2">
          {label}
          <span aria-hidden="true" className="text-xs opacity-80">
            ▾
          </span>
        </span>
      </Button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={cx(
            "absolute z-50 mt-2 min-w-[10rem] overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200",
            "dark:bg-slate-900 dark:ring-slate-800",
            menuAlign
          )}
        >
          <div className="py-1">
            {items.map((it) => {
              const common =
                "block w-full px-3 py-2 text-left text-sm transition " +
                "text-slate-700 hover:bg-slate-50 hover:text-slate-900 " +
                "dark:text-slate-200 dark:hover:bg-slate-800/60 dark:hover:text-white " +
                "disabled:opacity-50 disabled:cursor-not-allowed";

              if (it.href) {
                return (
                  <a
                    key={it.label}
                    role="menuitem"
                    href={it.href}
                    className={common}
                    aria-disabled={it.disabled || undefined}
                    onClick={(e) => {
                      if (it.disabled) {
                        e.preventDefault();
                        return;
                      }
                      setOpen(false);
                    }}
                  >
                    {it.label}
                  </a>
                );
              }

              return (
                <button
                  key={it.label}
                  role="menuitem"
                  type="button"
                  className={common}
                  disabled={it.disabled}
                  onClick={() => {
                    if (it.disabled) return;
                    it.onClick?.();
                    setOpen(false);
                  }}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}