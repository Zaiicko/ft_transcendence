import { Component, ReactNode } from 'react';
import { withTranslation, WithTranslation } from 'react-i18next';

// Class component (React has no render-error hook) that catches subtree exceptions and shows a reload fallback instead of a white screen.
class ErrorBoundaryBase extends Component<
  WithTranslation & { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    const { t, children } = this.props;
    if (!this.state.hasError) return children;
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">{t('errors.boundary.title')}</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('errors.boundary.body')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110"
        >
          {t('errors.boundary.retry')}
        </button>
      </div>
    );
  }
}

const ErrorBoundary = withTranslation()(ErrorBoundaryBase);
export default ErrorBoundary;
