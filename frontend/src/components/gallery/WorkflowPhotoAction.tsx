import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import type { Photo } from '../../types';
import { feedbackService } from '../../services/feedback.service';
import { useGuestIdentityOptional } from '../../contexts/GuestIdentityContext';

export function WorkflowPhotoAction({
  photo,
  slug,
  onFeedbackChange,
  onRequestClick,
}: {
  photo: Photo;
  slug: string;
  onFeedbackChange?: () => void;
  onRequestClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const guestIdentity = useGuestIdentityOptional();
  const [selected, setSelected] = useState(photo.retouch_selected ?? photo.my_color_label === 'green');
  const [busy, setBusy] = useState(false);
  const delivered = photo.retouch_state === 'delivered';

  useEffect(() => setSelected(photo.retouch_selected ?? photo.my_color_label === 'green'), [photo.retouch_selected, photo.my_color_label]);

  const updateSelection = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (busy) return;

    if (delivered && !selected) {
      onRequestClick(event);
      return;
    }
    if (delivered && selected && !window.confirm(t('photographyWorkflow.cancelDeliveredConfirm'))) return;

    setBusy(true);
    try {
      if (guestIdentity?.identityMode === 'guest') await guestIdentity.ensureIdentity();
      const result = await feedbackService.submitFeedback(slug, String(photo.id), {
        feedback_type: 'color_label',
        color_label: 'green',
      });
      const nextSelected = !result?.removed;
      setSelected(nextSelected);
      toast.success(t(nextSelected
        ? 'photographyWorkflow.selectionAdded'
        : delivered ? 'photographyWorkflow.deliveredSelectionRemoved' : 'photographyWorkflow.selectionRemoved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gallery-photos', slug] }),
        queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] }),
      ]);
      onFeedbackChange?.();
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      toast.error(error?.response?.status === 429
        ? t('feedback.rateLimited')
        : t('photographyWorkflow.selectionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const label = delivered
    ? selected ? t('photographyWorkflow.cancelSelection') : t('retouchRequest.open')
    : selected
      ? t('photographyWorkflow.selectedForRetouch')
      : t('photographyWorkflow.selectForRetouch');
  const description = selected && !delivered ? t('photographyWorkflow.cancelSelection') : label;

  return (
    <button
      type="button"
      onClick={updateSelection}
      disabled={busy}
      aria-label={description}
      aria-pressed={delivered && !selected ? undefined : selected}
      title={description}
      className={`absolute bottom-2 right-2 z-[15] inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        delivered && !selected
          ? 'bg-amber-600 text-white hover:bg-amber-700'
          : selected
            ? 'bg-emerald-700 text-white hover:bg-emerald-800'
            : 'bg-white text-neutral-900 hover:bg-emerald-50'
      } ${busy ? 'cursor-wait opacity-80' : ''}`}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : delivered && !selected ? <ClipboardList className="h-4 w-4" aria-hidden="true" /> : selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      <span>{busy ? t('photographyWorkflow.selectionSubmitting') : label}</span>
    </button>
  );
}
