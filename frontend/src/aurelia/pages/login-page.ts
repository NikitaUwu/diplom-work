import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './login-page.html?raw';
import { sessionState } from '../state/session-state';

export class LoginPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'login-page', template };

  private readonly router = resolve(IRouter);

  public email = '';
  public password = '';
  public busy = false;
  public error = '';

  public async loading(): Promise<void> {
    await sessionState.redirectIfAuthenticated(this.router, '/upload');
  }

  public async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error = '';
    this.busy = true;

    try {
      await sessionState.loginAndLoadUser({ email: this.email, password: this.password });
      await this.router.load('/upload');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка входа';
    } finally {
      this.busy = false;
    }
  }
}
