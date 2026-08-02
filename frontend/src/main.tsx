import '@fontsource-variable/sora'; // self-hosted display font (no CDN)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { i18nReady } from './i18n';
import './index.css';

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
