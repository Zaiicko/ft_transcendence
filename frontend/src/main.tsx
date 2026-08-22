import '@fontsource-variable/sora'; // self-hosted display font (no CDN)
import * as Sentry from '@sentry/browser';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { i18nReady } from './i18n';
import './index.css';

// @sentry/browser, not @sentry/react: the React package's module-scope side
// effects collided with the manual react/react-dom chunk split (see
// vite.config.ts) and broke the app in prod ("Cannot set properties of
// undefined (setting 'Activity')", #root never mounted). This package has no
// react dependency at all — global error/unhandledrejection capture only, no
// ErrorBoundary/Profiler component, so there's nothing left to collide with.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, tracesSampleRate: 0 });
}

// Wait for the active language to load (lazy locales) before rendering: no flash of raw keys, and i18n.language is ready for all components.
void i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
