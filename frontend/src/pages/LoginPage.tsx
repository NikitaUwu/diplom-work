import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { login } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await login({ email, password });
      navigate("/upload", { replace: true });
    } catch (e: any) {
      setError(e?.message ?? "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* фон */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-slate-200/60 blur-3xl dark:bg-slate-800/40" />
        <div className="absolute -bottom-40 right-10 h-80 w-80 rounded-full bg-slate-200/50 blur-3xl dark:bg-slate-800/30" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
        <div className="grid w-full max-w-4xl grid-cols-1 gap-6 lg:grid-cols-2">
          {/* левая часть */}
          <div className="hidden lg:flex">
            <div className="w-full rounded-2xl bg-slate-900 p-10 text-white shadow-sm ring-1 ring-white/10">
              <div className="text-xs font-semibold tracking-widest text-white/60">
                CHART EXTRACTION
              </div>
              <h1 className="mt-3 text-3xl font-semibold leading-tight">
                Вход в систему обработки графиков
              </h1>
              <p className="mt-4 text-sm text-white/75">
                Загружайте изображения графиков, получайте интерактивное отображение и экспорт
                точек. Даже при ошибке пайплайна будут доступны диагностические артефакты.
              </p>

              <div className="mt-8 rounded-xl bg-white/10 p-4 text-sm text-white/80 ring-1 ring-white/10">
                Совет: выбирайте изображения без сильного наклона и с читаемыми подписями осей —
                так точность обычно выше.
              </div>
            </div>
          </div>

          {/* форма */}
          <div className="flex">
            <Card
              title="Вход"
              description="Введите email и пароль, чтобы продолжить"
              className="w-full"
            >
              <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                  <Alert variant="danger" title="Ошибка входа">
                    <div className="whitespace-pre-wrap">{error}</div>
                  </Alert>
                )}

                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Email
                  </label>
                  <input
                    className="mt-1 w-full rounded-xl bg-white px-4 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none transition
                               placeholder:text-slate-400 focus:ring-2 focus:ring-slate-400
                               dark:bg-slate-900/60 dark:text-slate-100 dark:ring-slate-700 dark:placeholder:text-slate-500 dark:focus:ring-slate-500/60"
                    placeholder="name@company.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    required
                    disabled={busy}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Пароль
                  </label>
                  <input
                    className="mt-1 w-full rounded-xl bg-white px-4 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 outline-none transition
                               placeholder:text-slate-400 focus:ring-2 focus:ring-slate-400
                               dark:bg-slate-900/60 dark:text-slate-100 dark:ring-slate-700 dark:placeholder:text-slate-500 dark:focus:ring-slate-500/60"
                    placeholder="••••••••"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    disabled={busy}
                  />
                </div>

                <Button
                  type="submit"
                  loading={busy}
                  disabled={!email || !password || busy}
                  className="w-full"
                >
                  Войти
                </Button>

                <div className="text-center text-sm text-slate-600 dark:text-slate-300">
                  Нет аккаунта?{" "}
                  <Link
                    to="/register"
                    className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    Зарегистрироваться
                  </Link>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}