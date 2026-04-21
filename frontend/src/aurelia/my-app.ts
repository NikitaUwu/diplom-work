import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './my-app.html?raw';
import { sessionState } from './state/session-state';
import { themeState } from './state/theme-state';

export class MyApp implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'my-app', template };
  public static readonly title = 'Chart Extraction';
  public static readonly routes = [
    { path: ['', '/'], component: () => import('./pages/start-page'), title: 'Старт' },
    { path: '/login', component: () => import('./pages/login-page'), title: 'Вход' },
    { path: '/register', component: () => import('./pages/register-page'), title: 'Регистрация' },
    { path: '/upload', component: () => import('./pages/upload-page'), title: 'Загрузка' },
    { path: '/results', component: () => import('./pages/results-page'), title: 'Результаты' },
    { path: '/charts/:id', component: () => import('./pages/chart-page'), title: 'График' },
    { path: '/charts/:id/spline-points', component: () => import('./pages/spline-points-page'), title: 'Сплайн по N точкам' },
  ];

  private readonly router = resolve(IRouter);

  public readonly session = sessionState;
  public readonly theme = themeState;

  public async logout(): Promise<void> {
    await this.session.logoutAndClear();
    await this.router.load('/login');
  }

  public toggleTheme(): void {
    this.theme.toggle();
  }
}
