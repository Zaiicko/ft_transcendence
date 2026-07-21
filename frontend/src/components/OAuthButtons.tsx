import { useLocation } from 'react-router-dom';

// Connexion via fournisseurs OAuth/OpenID : boutons logo (sans texte). Fond
// aux couleurs de chaque marque pour que le logo contraste en jour comme en
// nuit. Partagé par Login et Signup.
const BASE =
  'flex h-11 flex-1 items-center justify-center rounded-full border transition hover:brightness-110';

export default function OAuthButtons() {
  const location = useLocation();

  // Le flux OAuth 42/Google est une redirection pleine page : on mémorise la
  // page d'origine (transmise via location.state.from) dans sessionStorage, que
  // LegacyProfileRedirect relira au retour pour un compte existant.
  const rememberOrigin = () => {
    const from = (location.state as { from?: string } | null)?.from;
    const dest = from && !['/login', '/signup'].includes(from) ? from : '/';
    sessionStorage.setItem('postLoginRedirect', dest);
  };

  return (
    <div className="flex gap-3">
      <a
        href="/api/auth/google"
        onClick={rememberOrigin}
        title="Continuer avec Google"
        aria-label="Continuer avec Google"
        className={`${BASE} border-zinc-300 bg-white`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
          />
        </svg>
      </a>

      <a
        href="/api/auth/42"
        onClick={rememberOrigin}
        title="Continuer avec 42"
        aria-label="Continuer avec 42"
        className={`${BASE} border-black bg-black text-base font-bold text-white`}
      >
        42
      </a>

      <a
        href="/api/auth/steam"
        onClick={rememberOrigin}
        title="Continuer avec Steam"
        aria-label="Continuer avec Steam"
        className={`${BASE} border-[#1b2838] bg-[#1b2838] text-white`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
        </svg>
      </a>
    </div>
  );
}
