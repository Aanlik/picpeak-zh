import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

// SVG Flag Components
const GBFlag: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg">
    <path fill="#012169" d="M0 0h640v480H0z"/>
    <path fill="#FFF" d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0h75z"/>
    <path fill="#C8102E" d="m424 281 216 159v40L369 281h55zm-184 20 6 35L54 480H0l240-179zM640 0v3L391 191l2-44L590 0h50zM0 0l239 176h-60L0 42V0z"/>
    <path fill="#FFF" d="M241 0v480h160V0H241zM0 160v160h640V160H0z"/>
    <path fill="#C8102E" d="M0 193v96h640v-96H0zM273 0v480h96V0h-96z"/>
  </svg>
);

const CNFlag: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="30" height="20" fill="#DE2910" />
    <path fill="#FFDE00" d="M5 2 5.7 4.1 8 4.1 6.2 5.4 6.9 7.6 5 6.2 3.1 7.6 3.8 5.4 2 4.1 4.3 4.1Z" />
    <path fill="#FFDE00" d="M10 1 10.45 2.15 11.7 2.2 10.75 2.9 11.1 4.1 10 3.4 8.9 4.1 9.25 2.9 8.3 2.2 9.55 2.15Z" transform="rotate(25 10 2.55)" />
    <path fill="#FFDE00" d="M12 4 12.45 5.15 13.7 5.2 12.75 5.9 13.1 7.1 12 6.4 10.9 7.1 11.25 5.9 10.3 5.2 11.55 5.15Z" transform="rotate(45 12 5.55)" />
    <path fill="#FFDE00" d="M12 8 12.45 9.15 13.7 9.2 12.75 9.9 13.1 11.1 12 10.4 10.9 11.1 11.25 9.9 10.3 9.2 11.55 9.15Z" transform="rotate(65 12 9.55)" />
    <path fill="#FFDE00" d="M10 11 10.45 12.15 11.7 12.2 10.75 12.9 11.1 14.1 10 13.4 8.9 14.1 9.25 12.9 8.3 12.2 9.55 12.15Z" transform="rotate(85 10 12.55)" />
  </svg>
);

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文', Flag: CNFlag },
  { code: 'en', name: 'English', Flag: GBFlag },
];

export const LanguageSelector: React.FC = () => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);

  const currentLanguage = SUPPORTED_LANGUAGES.find(lang => lang.code === i18n.resolvedLanguage) || SUPPORTED_LANGUAGES[1];

  const handleLanguageChange = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 sm:px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        // On <sm the language *name* is hidden — the Globe + flag pair
        // is enough recognition on its own and stops this control from
        // pushing into the company-name title on narrow mobile widths
        // (#523). Full name stays on sm+ where there's room.
        aria-label={currentLanguage.name}
        title={currentLanguage.name}
      >
        <Globe className="w-4 h-4" />
        <currentLanguage.Flag className="w-5 h-5" />
        <span className="hidden sm:inline">{currentLanguage.name}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1 z-50">
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language.code}
              onClick={() => handleLanguageChange(language.code)}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-3 ${
                language.code === i18n.resolvedLanguage
                  ? 'text-accent bg-accent-dark/15'
                  : 'text-neutral-700 dark:text-neutral-300'
              }`}
            >
              <language.Flag className="w-5 h-5" />
              <span>{language.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

LanguageSelector.displayName = 'LanguageSelector';
