import { Aurelia } from 'aurelia';
import { SVGAnalyzer } from '@aurelia/runtime-html';
import './index.css';
import { MyApp } from './aurelia/my-app';
import { ImageCarousel } from './aurelia/components/image-carousel';
import { ReactGraphEditor } from './aurelia/components/react-graph-editor';
import { ChartPage } from './aurelia/pages/chart-page';
import { LoginPage } from './aurelia/pages/login-page';
import { RegisterPage } from './aurelia/pages/register-page';
import { ResultsPage } from './aurelia/pages/results-page';
import { StartPage } from './aurelia/pages/start-page';
import { UploadPage } from './aurelia/pages/upload-page';
import { sessionState } from './aurelia/state/session-state';
import { themeState } from './aurelia/state/theme-state';

themeState.initialize();
await sessionState.restore();

await Aurelia
  .register(
    SVGAnalyzer,
    ReactGraphEditor,
    ImageCarousel,
    StartPage,
    LoginPage,
    RegisterPage,
    UploadPage,
    ResultsPage,
    ChartPage,
  )
  .app(MyApp)
  .start();
