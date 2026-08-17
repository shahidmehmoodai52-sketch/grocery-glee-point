import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpApi from 'i18next-http-backend';

// @ts-ignore - for debugging
if (typeof window !== 'undefined') { window.i18nDebug = i18n; }

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ur', 'ar', 'es', 'de', 'no'],
    debug: true, // Enable debug to see what's happening in console
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: '/locales/{{lng}}/translation.json',
    },
    detection: {
      order: ['localStorage', 'cookie', 'htmlTag', 'path', 'subdomain'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });


// Synchronize document direction whenever language changes
i18n.on('languageChanged', (lng) => {
  console.log('i18n languageChanged event:', lng);
  const rtlLanguages = ['ur', 'ar'];
  const dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr';
  
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    document.documentElement.lang = lng;
  }
  
  // Persist language to local storage explicitly to ensure cross-route consistency
  if (typeof window !== 'undefined') {
    localStorage.setItem('i18nextLng', lng);
  }
});

if (typeof window !== 'undefined') {
  (window as any).i18next = i18n;
}

export default i18n;
