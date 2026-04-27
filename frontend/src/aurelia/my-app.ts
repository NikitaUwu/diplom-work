import template from './my-app.html?raw';
import { APP_NAVIGATION_EVENT, navigateTo, readRoute, type AppRoute } from './navigation';
import { sessionState } from './state/session-state';
import { themeState } from './state/theme-state';

export class MyApp {
  public static readonly $au = { type: 'custom-element', name: 'my-app', template };
  public static readonly title = 'Chart Extraction';

  public readonly session = sessionState;
  public readonly theme = themeState;
  public route: AppRoute = readRoute();

  public attaching(): void {
    window.addEventListener('popstate', this.syncRoute);
    window.addEventListener(APP_NAVIGATION_EVENT, this.syncRoute);
  }

  public detaching(): void {
    window.removeEventListener('popstate', this.syncRoute);
    window.removeEventListener(APP_NAVIGATION_EVENT, this.syncRoute);
  }

  public async logout(): Promise<void> {
    await this.session.logoutAndClear();
    navigateTo('/login');
  }

  public toggleTheme(): void {
    this.theme.toggle();
  }

  public navigate(event: Event, path: string): void {
    event.preventDefault();
    navigateTo(path);
  }

  private readonly syncRoute = () => {
    this.route = readRoute();
  };
}
