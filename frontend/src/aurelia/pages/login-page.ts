import template from './login-page.html?raw';
import { navigateTo } from '../navigation';
import { sessionState } from '../state/session-state';

export class LoginPage {
  public static readonly $au = { type: 'custom-element', name: 'login-page', template };

  public email = '';
  public password = '';
  public busy = false;
  public error = '';

  public async binding(): Promise<void> {
    await sessionState.redirectIfAuthenticated('/upload');
  }

  public async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error = '';
    this.busy = true;

    try {
      await sessionState.loginAndLoadUser({ email: this.email, password: this.password });
      navigateTo('/upload');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка входа';
    } finally {
      this.busy = false;
    }
  }
}
