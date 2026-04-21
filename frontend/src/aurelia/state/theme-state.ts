export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
let transitionTimer: number | null = null;

function getInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(STORAGE_KEY, theme);
}

function withThemeTransition(ms = 280): void {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  if (transitionTimer !== null) {
    window.clearTimeout(transitionTimer);
  }

  transitionTimer = window.setTimeout(() => {
    root.classList.remove('theme-transition');
    transitionTimer = null;
  }, ms);
}

function toggleTheme(current: Theme): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  withThemeTransition(280);
  applyTheme(next);
  return next;
}

class ThemeState {
  public theme: Theme = 'light';
  private initialized = false;

  public initialize(): void {
    if (this.initialized) {
      return;
    }

    this.theme = getInitialTheme();
    applyTheme(this.theme);
    this.initialized = true;
  }

  public toggle(): void {
    this.theme = toggleTheme(this.theme);
  }
}

export const themeState = new ThemeState();
