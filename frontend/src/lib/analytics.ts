// window.umami exists only when the tracker script loaded (see main.tsx) —
// absent in local/dev builds, where VITE_UMAMI_WEBSITE_ID is unset.
declare global {
  interface Window {
    umami?: { track: (eventName: string) => void };
  }
}

export function trackEvent(eventName: string): void {
  window.umami?.track(eventName);
}
