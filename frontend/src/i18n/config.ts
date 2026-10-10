import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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
const normalizeSupportedLanguage = (language: string | undefined): 'en' | 'zh-CN' | undefined => {
  if (!language) return undefined;
  if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(language)) return 'en';
  return 'en';
};

detector.addDetector({
  name: 'deploymentDefault',
  lookup: () => normalizeSupportedLanguage(import.meta.env.VITE_DEFAULT_LANGUAGE),
});

i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: false,

    // An empty translation should fall through to English rather than render a
    // blank UI label.
    returnEmptyString: false,

    resources,
    supportedLngs: ['en', 'zh-CN'],
    load: 'currentOnly',

    interpolation: {
      escapeValue: false,
    },

    // Use v4 format for pluralization (_one/_other instead of _plural suffix)
    compatibilityJSON: 'v4',

    detection: {
      order: ['localStorage', 'cookie', 'deploymentDefault', 'navigator', 'htmlTag'],
      caches: ['localStorage', 'cookie'],
      convertDetectedLanguage: (language: string) => normalizeSupportedLanguage(language) || 'en',
    },
  });

export default i18n;
