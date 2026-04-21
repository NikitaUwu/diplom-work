import type { IRouter } from '@aurelia/router-direct';
import { login, logout, me, register, type LoginRequest, type RegisterRequest, type UserRead } from '../../api/client';

class SessionState {
  public user: UserRead | null = null;
  public checked = false;
  public restoring = false;

  public get isAuthenticated(): boolean {
    return this.user !== null;
  }

  public async restore(force = false): Promise<UserRead | null> {
    if (this.restoring) {
      return this.user;
    }

    if (this.checked && !force) {
      return this.user;
    }

    this.restoring = true;

    try {
      this.user = await me();
    } catch {
      this.user = null;
    } finally {
      this.checked = true;
      this.restoring = false;
    }

    return this.user;
  }

  public async loginAndLoadUser(request: LoginRequest): Promise<UserRead | null> {
    await login(request);
    return this.restore(true);
  }

  public async registerAndLogin(request: RegisterRequest): Promise<UserRead | null> {
    await register(request);
    await login(request);
    return this.restore(true);
  }

  public async logoutAndClear(): Promise<void> {
    try {
      await logout();
    } finally {
      this.user = null;
      this.checked = true;
    }
  }

  public async ensureAuthenticated(router: IRouter, redirectTo = '/login'): Promise<boolean> {
    const user = await this.restore();
    if (user) {
      return true;
    }

    await router.load(redirectTo);
    return false;
  }

  public async redirectIfAuthenticated(router: IRouter, redirectTo = '/upload'): Promise<boolean> {
    const user = await this.restore();
    if (!user) {
      return false;
    }

    await router.load(redirectTo);
    return true;
  }
}

export const sessionState = new SessionState();
