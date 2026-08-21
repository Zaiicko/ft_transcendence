import '@fontsource-variable/sora'; // self-hosted display font (no CDN)
import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { i18nReady } from './i18n';
import './index.css';

// Self-hosted GlitchTip (Sentry-protocol compatible) — see
// docker-compose.prod.yml. Baked in at build time (Dockerfile.prod ARG), so
// it's simply absent from local/dev builds where the arg isn't passed.
// tracesSampleRate: 0 — error capture only, no performance tracing (keeps
// event volume low on a small self-hosted instance).
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
