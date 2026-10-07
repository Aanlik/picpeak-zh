import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

const localeFiles = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });

const resources = Object.fromEntries(
  Object.entries(localeFiles).map(([path, translations]) => {
    const lang = path.match(/\/([\w-]+)\.json$/)?.[1];
    return [lang, { translation: translations }];
  })
);

// An optional build-time deployment default comes after the visitor's saved
// choice and before browser detection. It never overrides an explicit choice.
const detector = new LanguageDetector();
detector.addDetector({
  name: 'deploymentDefault',
  lookup: () => import.meta.env.VITE_DEFAULT_LANGUAGE || undefined,
});

i18n
  .use(HttpBackend)
  .use(detector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: false,

    // i18next defaults this to `true`, which makes an empty-string translation
    // a *valid* lookup — it renders as blank UI instead of falling through to
    // `fallbackLng`. nl/pt/ru/fr/sl/es are deliberately partial locales, so an
    // empty value landing in one of them must fail safe to English rather than
    // silently blanking the label. No managed locale has one today; this keeps
    // it true by construction rather than by vigilance.
    returnEmptyString: false,

    resources,
    supportedLngs: Object.keys(resources),
    load: 'currentOnly',

    interpolation: {
      escapeValue: false,
    },

    // Use v4 format for pluralization (_one/_other instead of _plural suffix)
    compatibilityJSON: 'v4',

    detection: {
      order: ['localStorage', 'cookie', 'deploymentDefault', 'navigator', 'htmlTag'],
      caches: ['localStorage', 'cookie'],
      convertDetectedLanguage: (language: string) => /^zh(?:-|$)/i.test(language)
        ? 'zh-CN'
        : language.split('-')[0],
    },
  });

export default i18n;
