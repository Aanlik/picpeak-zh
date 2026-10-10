/**
 * The product ships English and Simplified Chinese UI languages; unsupported
 * legacy locale codes safely use English date names.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let language = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language } }),
}));

vi.mock('../usePublicSettings', () => ({
  usePublicSettings: () => ({ data: undefined }),
}));

import { useLocalizedDate } from '../useLocalizedDate';

// 2026-03-04 is a Wednesday.
const date = new Date(2026, 2, 4, 12, 0, 0);

describe('useLocalizedDate locale resolution', () => {
  it.each([
    ['en', 'March', 'Wednesday'],
    ['en-US', 'March', 'Wednesday'],
    ['zh', '三月', '星期三'],
    ['zh-CN', '三月', '星期三'],
  ])('%s → month %s, weekday %s', (lang, month, weekday) => {
    language = lang;
    const { result } = renderHook(() => useLocalizedDate());
    expect(result.current.format(date, 'd MMMM yyyy')).toContain(month);
    expect(result.current.format(date, 'EEEE')).toBe(weekday);
  });

  it('falls back to English for an unknown language', () => {
    language = 'xx';
    const { result } = renderHook(() => useLocalizedDate());
    expect(result.current.format(date, 'EEEE')).toBe('Wednesday');
  });

  it('localises Chinese relative times too', () => {
    language = 'zh-CN';
    const { result } = renderHook(() => useLocalizedDate());
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(result.current.formatDistanceToNow(twoDaysAgo, { addSuffix: true })).toBe('2 天前');
  });
});
