export default function Spinner({ label = "Обновляется" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <span>{label}</span>
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
    </div>
  );
}
