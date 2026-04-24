import { Aurelia } from 'aurelia';
import { SVGAnalyzer } from '@aurelia/runtime-html';
import { RouterConfiguration } from '@aurelia/router-direct';
import './index.css';
import { MyApp } from './aurelia/my-app';
import { ImageCarousel } from './aurelia/components/image-carousel';
import { ReactGraphEditor } from './aurelia/components/react-graph-editor';
import { sessionState } from './aurelia/state/session-state';
import { themeState } from './aurelia/state/theme-state';

themeState.initialize();
await sessionState.restore();

await Aurelia
  .register(
    SVGAnalyzer,
    RouterConfiguration,
    ReactGraphEditor,
    ImageCarousel,
  )
  .app(MyApp)
  .start();
