import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files statically
import enTranslation from '../../public/locales/en/translation.json';
import urTranslation from '../../public/locales/ur/translation.json';
import arTranslation from '../../public/locales/ar/translation.json';
import esTranslation from '../../public/locales/es/translation.json';
import deTranslation from '../../public/locales/de/translation.json';
import noTranslation from '../../public/locales/no/translation.json';

// Synchronize document direction whenever language changes
const syncDir = (lng: string) => {
  const rtlLanguages = ['ur', 'ar'];
  const dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr';
  
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    document.documentElement.lang = lng;
  }
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('i18nextLng', lng);
  }
};

const resources = {
  en: { translation: enTranslation },
  ur: { translation: urTranslation },
  ar: { translation: arTranslation },
  es: { translation: esTranslation },
  de: { translation: deTranslation },
  no: { translation: noTranslation },
};

// LanguageDetector reads navigator/document/localStorage, none of which exist
// during server-side rendering. Chaining it in unconditionally leaves i18next
// stuck "not initialized" on the server, so every t() call there returns the
// raw key (e.g. "landing.hero.title") instead of real text — exactly what a
// crawler or a first-paint SSR snapshot sees. Only use it in the browser; the
// server always renders the deterministic fallback language.
let chain = i18n.use(initReactI18next);
if (typeof window !== 'undefined') {
  chain = chain.use(LanguageDetector);
}

chain.init({
    resources,
    lng: typeof window === 'undefined' ? 'en' : undefined,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ur', 'ar', 'es', 'de', 'no'],
    debug: false,
    // @ts-ignore - Required for synchronous initialization with static resources
    initImmediate: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'cookie', 'htmlTag', 'path', 'subdomain'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  }, (err) => {
    if (!err && typeof window !== 'undefined') {
      syncDir(i18n.language);
    }
  });

i18n.on('languageChanged', (lng) => {
  syncDir(lng);
});

if (typeof window !== 'undefined') {
  (window as any).i18next = i18n;
}

export default i18n;
