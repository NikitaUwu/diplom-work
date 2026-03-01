import { useMemo, useState } from "react";
import Button from "./ui/Button";

export type CarouselItem = {
  label: string;
  src: string;
};

type Props = {
  items: CarouselItem[];
  className?: string;
};

export default function Carousel({
  items,
  className = ""
}: Props) {
  const safeItems = useMemo(() => items?.filter(Boolean) ?? [], [items]);
  const [idx, setIdx] = useState(0);

  if (!safeItems.length) {
    return (
      <div
        className={`flex h-64 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-900/40 dark:ring-slate-800 ${className}`}
      >
        <div className="text-sm text-slate-600 dark:text-slate-400">Изображения недоступны</div>
      </div>
    );
  }

  const current = safeItems[Math.min(idx, safeItems.length - 1)];
  const canNav = safeItems.length > 1;

  function prev() {
    setIdx((v) => (v - 1 + safeItems.length) % safeItems.length);
  }

  function next() {
    setIdx((v) => (v + 1) % safeItems.length);
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 ${className}`}
    >

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{current.label}</div>

        {canNav ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={prev}>
              ←
            </Button>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {idx + 1} / {safeItems.length}
            </div>
            <Button type="button" variant="secondary" onClick={next}>
              →
            </Button>
          </div>
        ) : (
          <div className="text-xs text-slate-500 dark:text-slate-400">1 / 1</div>
        )}
      </div>

      <div className="bg-slate-50 p-4 dark:bg-slate-950/30">
        <div className="aspect-video overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <img
            src={current.src}
            alt={current.label}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
}