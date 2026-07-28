import '@fontsource-variable/sora'; // fonte display self-hostée (aucun CDN)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { i18nReady } from './i18n';
import './index.css';

// On attend que la langue active soit chargée (locales en lazy) avant de rendre :
// pas de flash de clés brutes, et i18n.language est prêt pour tous les composants.
void i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
