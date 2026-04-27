import template from './start-page.html?raw';
import { sessionState } from '../state/session-state';

export class StartPage {
  public static readonly $au = { type: 'custom-element', name: 'start-page', template };

  public readonly session = sessionState;

  public async binding(): Promise<void> {
    await this.session.restore();
  }
}
