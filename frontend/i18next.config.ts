import { defineConfig } from 'i18next-cli';
import { typescriptPlugin } from "./scripts/i18nextExtractionHelper";


export default defineConfig({
  // Keep the extractor focused on the two complete dictionaries. Other upstream
  // languages (including de) are partial and use fallbackLng: 'en'.
  locales: ['en', 'zh-CN'],

  extract: {
    input: ['src/**/*.{ts,tsx,js,jsx}'],
    // `glob` (used by i18next-cli) ignores `!`-prefixed entries inside `input`,
    // so exclusions have to live here or they are silently no-ops.
    ignore: [
      'src/**/*.{test,spec}.{ts,tsx,js,jsx}',
      'src/**/__tests__/**',
      'src/**/*.d.ts',
    ],
    output: 'src/i18n/locales/{{language}}.json',
    defaultNS: false,

    primaryLanguage: 'en',

    // Runtime-built translation keys are not fully visible to the AST extractor, so
    // removing unused keys here could delete live UI text. Key removal stays manual.
    removeUnusedKeys: false,

    preserveContextVariants: true,

    indentation: 2,
    sort: false,
  },
  plugins: [typescriptPlugin(["./src/App.tsx"]) ]
});
