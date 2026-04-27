export type AppRoute =
  | { name: 'start' }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'upload' }
  | { name: 'results' }
  | { name: 'chart'; id: number };

export const APP_NAVIGATION_EVENT = 'app:navigation';

export function readRoute(pathname = window.location.pathname): AppRoute {
  const normalized = pathname.replace(/\/+$/, '') || '/';

  if (normalized === '/login') {
    return { name: 'login' };
  }

  if (normalized === '/register') {
    return { name: 'register' };
  }

  if (normalized === '/upload') {
    return { name: 'upload' };
  }

  if (normalized === '/results') {
    return { name: 'results' };
  }

  const chartMatch = normalized.match(/^\/charts\/(\d+)$/);
  if (chartMatch) {
    return { name: 'chart', id: Number(chartMatch[1]) };
  }

  return { name: 'start' };
}

export function navigateTo(path: string): void {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.pathname !== normalized) {
    window.history.pushState(null, '', normalized);
  }
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}
