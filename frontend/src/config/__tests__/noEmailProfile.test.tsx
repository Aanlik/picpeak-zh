import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../../components/common/Input';
import { PublishGalleryDialog } from '../../components/admin/PublishGalleryDialog';
vi.mock('../communication', () => ({ NO_EMAIL_MODE: true }));
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }) }));
describe('no-email photography profile', () => {
  it('removes email controls including labels and helper copy', () => {
    const { container } = render(<Input type="email" label="客户邮箱" helperText="发送邮件" />);
    expect(container.textContent).toBe(''); expect(container.querySelector('input')).toBeNull();
  });
  it('keeps username and password controls', () => {
    render(<><Input label="用户名" type="text" /><Input label="密码" type="password" /></>);
    expect(screen.getByLabelText('用户名')).toBeTruthy(); expect(screen.getByLabelText('密码')).toBeTruthy();
  });
  it('publishes quietly even when legacy event has email recipient', () => {
    const confirm = vi.fn();
    render(<PublishGalleryDialog eventName="测试项目" customerEmail="legacy@example.com" assignedCustomerCount={2} requirePassword={true} isPublishing={false} onConfirm={confirm} onClose={() => {}} />);
    expect(screen.getByText('发布「测试项目」后，请复制分享链接发送给客户。')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('legacy@example.com')).toBeNull();
  });
});
