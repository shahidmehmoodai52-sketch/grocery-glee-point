import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpApi from 'i18next-http-backend';

// Synchronize document direction whenever language changes
const syncDir = (lng: string) => {
  console.log('i18n syncDir:', lng);
  const rtlLanguages = ['ur', 'ar'];
  const dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr';
  
  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    // No layout recalc needed to avoid flickering
    // document.body logic removed to fix flicker during language switch
    document.documentElement.lang = lng;
  }
  
  if (typeof window !== 'undefined') {
    localStorage.setItem('i18nextLng', lng);
  }
};

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ur', 'ar', 'es', 'de', 'no'],
    debug: false,
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
