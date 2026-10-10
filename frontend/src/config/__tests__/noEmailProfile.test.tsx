import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublishGalleryDialog } from '../../components/admin/PublishGalleryDialog';
vi.mock('../../config/photography', () => ({ PHOTO_WORKFLOW_MODE: true }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
        return String((fallback as { defaultValue: string }).defaultValue).replace('{{eventName}}', '测试项目');
      }
      return key;
    }
  })
}));
describe('no-email photography profile', () => {
  it('publishes a share link without email controls or notification options', () => {
    const confirm = vi.fn();
    render(<PublishGalleryDialog eventName="测试项目" isPublishing={false} onConfirm={confirm} onClose={() => {}} />);
    expect(screen.getByText('发布“测试项目”后，客户即可通过分享链接访问。')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('legacy@example.com')).toBeNull();
  });
});
