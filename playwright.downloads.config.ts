import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/mobile-downloads', workers: 1, timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'docs/audits/2026-10-10-mobile-browser-results.json' }]],
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:19300', acceptDownloads: true },
  projects: [
    { name: 'iPhone Safari (WebKit)', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'Android Chrome', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
    { name: 'WeChat UA (Chromium simulation)', use: { ...devices['Pixel 5'], browserName: 'chromium', userAgent: devices['Pixel 5'].userAgent + ' MicroMessenger/8.0' } },
  ],
});
