export type BrowserFeatureName = 'Modules' | 'structuredClone' | 'IndexedDB' | 'WebAuthn' | 'Service workers' | 'Clipboard' | 'ResizeObserver';

export interface BrowserFeature {
  name: BrowserFeatureName;
  available: boolean;
  alternative: string;
}

/** Browser capabilities used by the client. The optional APIs have usable fallbacks. */
export function browserFeatures(env: typeof globalThis = globalThis): BrowserFeature[] {
  const nav = env.navigator;
  return [
    { name: 'Modules', available: typeof env.HTMLScriptElement !== 'undefined' && ('noModule' in env.HTMLScriptElement.prototype), alternative: 'Use a current browser with JavaScript module support.' },
    { name: 'structuredClone', available: typeof env.structuredClone === 'function', alternative: 'Use a current browser; this feature is required to edit records safely.' },
    { name: 'IndexedDB', available: typeof env.indexedDB !== 'undefined', alternative: 'The client still works online, but offline copies are unavailable. Allow site storage or use a browser that supports IndexedDB.' },
    { name: 'WebAuthn', available: !!nav?.credentials && typeof nav.credentials.get === 'function' && typeof env.PublicKeyCredential !== 'undefined', alternative: 'Sign in with your account name and password instead.' },
    { name: 'Service workers', available: !!nav?.serviceWorker, alternative: 'The client still works online, but offline loading is unavailable. Use the page while connected.' },
    { name: 'Clipboard', available: !!nav?.clipboard && typeof nav.clipboard.writeText === 'function', alternative: 'Use the browser or operating system copy and paste shortcuts.' },
    { name: 'ResizeObserver', available: typeof env.ResizeObserver !== 'undefined', alternative: 'The page can still resize with the browser window; some embedded panels may not adjust automatically.' },
  ];
}

export function browserFeatureMessage(feature: BrowserFeature): string {
  return `${feature.name} is unavailable. ${feature.alternative}`;
}
