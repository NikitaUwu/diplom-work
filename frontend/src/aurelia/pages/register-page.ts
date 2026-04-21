import { resolve } from 'aurelia';
import { IRouter, type IRouteableComponent } from '@aurelia/router-direct';
import template from './register-page.html?raw';
import { sessionState } from '../state/session-state';

export class RegisterPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'register-page', template };

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
      await sessionState.registerAndLogin({ email: this.email, password: this.password });
      await this.router.load('/upload');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка регистрации';
    } finally {
      this.busy = false;
    }
  }
}
