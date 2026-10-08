import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SetupEventTypesStep } from '../SetupEventTypesStep';
import { eventTypesService } from '../../../services/eventTypes.service';
vi.mock('../../../config/communication', () => ({ NO_EMAIL_MODE: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), initReactI18next: { type: '3rdParty', init: () => {} } }));
vi.mock('../../../services/eventTypes.service', () => ({ eventTypesService: {
 getEventTypes: vi.fn().mockResolvedValue([{ id: 42, name: '人像', slug_prefix: '', emoji: '📷' }]),
 updateEventType: vi.fn().mockResolvedValue({}), createEventType: vi.fn().mockResolvedValue({}), deleteEventType: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount(done = vi.fn()) {
 render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SetupEventTypesStep onDone={done} /></QueryClientProvider>);
 return done;
}
it('preserves Chinese names, fills missing prefixes and advances', async () => {
 const done = mount();
 const name = await screen.findByDisplayValue('人像');
 expect(screen.queryByLabelText('setup.eventTypes.slugLabel')).not.toBeInTheDocument();
 fireEvent.change(name, { target: { value: '家庭写真' } });
 fireEvent.click(screen.getByRole('button', { name: 'setup.continue' }));
 await waitFor(() => expect(done).toHaveBeenCalledOnce());
 expect(eventTypesService.updateEventType).toHaveBeenCalledWith(42, { name: '家庭写真', slug_prefix: 'photo-42' });
});
it('allows keeping existing types without applying draft changes', async () => {
 const done = mount();
 await screen.findByDisplayValue('人像');
 fireEvent.click(screen.getByRole('button', { name: 'setup.eventTypes.keepExisting' }));
 expect(done).toHaveBeenCalledOnce();
 expect(eventTypesService.updateEventType).not.toHaveBeenCalled();
 expect(eventTypesService.deleteEventType).not.toHaveBeenCalled();
});

it('adds Chinese types on HTTP NAS without requiring secure-context randomUUID', async () => {
 const done = mount();
 await screen.findByDisplayValue('人像');
 fireEvent.click(screen.getByRole('button', { name: 'setup.eventTypes.add' }));
 fireEvent.change(screen.getAllByLabelText('setup.eventTypes.nameLabel')[1], { target: { value: '婚礼跟拍' } });
 fireEvent.click(screen.getByRole('button', { name: 'setup.continue' }));
 await waitFor(() => expect(done).toHaveBeenCalledOnce());
 expect(eventTypesService.createEventType).toHaveBeenCalledWith({ name: '婚礼跟拍', slug_prefix: expect.stringMatching(/^photo-[a-f0-9]{16}$/), emoji: '📷' });
});
