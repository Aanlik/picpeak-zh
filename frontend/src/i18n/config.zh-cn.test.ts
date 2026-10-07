import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Simplified Chinese locale', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.cookie = 'i18next=; Max-Age=0; path=/';
    vi.unstubAllEnvs();
  });

  it('loads the hyphenated locale with workflow terminology', async () => {
    const { default: i18n } = await import('./config');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.hasResourceBundle('zh-CN', 'translation')).toBe(true);
    expect(i18n.t('feedback.setColorLabel', { color: i18n.t('feedback.colorLabels.green') })).toBe('选为精修');
    expect(i18n.t('feedback.markedAs', { color: i18n.t('feedback.colorLabels.green') })).toBe('已选精修');
    expect(i18n.t('gallery.photosSelected', { count: 50 })).toBe('已选择 50 张照片');
  });

  it('uses configured default without overriding a saved choice', async () => {
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'zh-CN');
    const first = (await import('./config')).default;
    expect(first.language).toBe('zh-CN');
    await first.changeLanguage('en');
    vi.resetModules();
    const second = (await import('./config')).default;
    expect(second.language).toBe('en');
  });

  it('recognises a Chinese browser locale', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['zh-SG']);
    const { default: i18n } = await import('./config');
    expect(i18n.language).toBe('zh-CN');
    vi.restoreAllMocks();
  });
});
