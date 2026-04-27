import template from './register-page.html?raw';
import { navigateTo } from '../navigation';
import { sessionState } from '../state/session-state';

export class RegisterPage {
  public static readonly $au = { type: 'custom-element', name: 'register-page', template };

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
      await sessionState.registerAndLogin({ email: this.email, password: this.password });
      navigateTo('/upload');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ошибка регистрации';
    } finally {
      this.busy = false;
    }
  }
}
