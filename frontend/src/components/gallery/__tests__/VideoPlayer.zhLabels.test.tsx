import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../../i18n/locales/en.json';
import zh from '../../../i18n/locales/zh-CN.json';
import { VideoPlayer } from '../VideoPlayer';

describe('视频控制语言切换', () => {
  it('translates accessible controls and updates them when the language changes', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', fallbackLng: 'en', resources: { en: { translation: en }, 'zh-CN': { translation: zh } } });
    render(<I18nextProvider i18n={i18n}><VideoPlayer src="/test.mp4" /></I18nextProvider>);
    expect(screen.getAllByLabelText('播放')).toHaveLength(2);
    expect(screen.getByLabelText('全屏播放')).toBeInTheDocument();
    await act(() => i18n.changeLanguage('en'));
    expect(screen.getAllByLabelText('Play')).toHaveLength(2);
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });
});
