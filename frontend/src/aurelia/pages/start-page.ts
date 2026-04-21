import { type IRouteableComponent } from '@aurelia/router-direct';
import template from './start-page.html?raw';
import { sessionState } from '../state/session-state';

export class StartPage implements IRouteableComponent {
  public static readonly $au = { type: 'custom-element', name: 'start-page', template };

  public readonly session = sessionState;

  public async loading(): Promise<void> {
    await this.session.restore();
  }
}
