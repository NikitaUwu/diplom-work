import { Aurelia } from 'aurelia';
import { SVGAnalyzer } from '@aurelia/runtime-html';
import { RouterConfiguration } from '@aurelia/router-direct';
import './index.css';
import { MyApp } from './aurelia/my-app';
import { CompactGraphEditor } from './aurelia/components/compact-graph-editor';
import { ImageCarousel } from './aurelia/components/image-carousel';
import { sessionState } from './aurelia/state/session-state';
import { themeState } from './aurelia/state/theme-state';

themeState.initialize();
await sessionState.restore();

await Aurelia
  .register(
    SVGAnalyzer,
    RouterConfiguration,
    CompactGraphEditor,
    ImageCarousel,
  )
  .app(MyApp)
  .start();
