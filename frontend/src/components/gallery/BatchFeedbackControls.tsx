import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Button } from '../common';
import { feedbackService } from '../../services/feedback.service';
import { useGuestIdentityOptional } from '../../contexts/GuestIdentityContext';

interface BatchFeedbackControlsProps {
  slug: string;
  photoIds: number[];
  colorLabelsEnabled: boolean;
  commentsEnabled: boolean;
  requireNameEmail: boolean;
}

/** Batch client proofing actions shown alongside the normal selection toolbar. */
export function BatchFeedbackControls({
  slug,
  photoIds,
  colorLabelsEnabled,
  commentsEnabled,
  requireNameEmail,
}: BatchFeedbackControlsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const guestIdentity = useGuestIdentityOptional();
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const isGuestMode = guestIdentity?.identityMode === 'guest';

  if (!photoIds.length || (!colorLabelsEnabled && !commentsEnabled)) return null;

  const refreshFeedback = () => {
    queryClient.invalidateQueries({ queryKey: ['gallery-photos', slug] });
    queryClient.invalidateQueries({ queryKey: ['my-feedback', slug] });
    queryClient.invalidateQueries({ queryKey: ['photo-feedback', slug] });
  };

  const submit = async (feedbackType: 'color_label' | 'comment') => {
    if (busy) return;
    if (feedbackType === 'color_label' && photoIds.length > 100) {
      toast.error(t('gallery.batchMarkLimit'));
      return;
    }
    if (feedbackType === 'comment' && photoIds.length > 20) {
      toast.error(t('gallery.batchCommentLimit'));
      return;
    }
    if (feedbackType === 'comment' && !comment.trim()) {
      toast.error(t('gallery.batchCommentRequired'));
      return;
    }
    if (feedbackType === 'comment' && requireNameEmail && !isGuestMode && (!name.trim() || !email.trim())) {
      toast.error(t('gallery.batchGuestInfoRequired'));
      return;
    }
    setBusy(true);
    try {
      if (isGuestMode && guestIdentity) await guestIdentity.ensureIdentity();
      const result = await feedbackService.submitBatchFeedback(slug, {
        photo_ids: photoIds,
        feedback_type: feedbackType,
        ...(feedbackType === 'color_label'
          ? { color_label: 'green' as const }
          : {
              comment_text: comment.trim(),
              guest_name: name.trim() || undefined,
              guest_email: email.trim() || undefined,
            }),
      });
      refreshFeedback();
      if (result.applied_count > 0) {
        if (feedbackType === 'color_label') {
          toast.success(t('gallery.batchMarkedForEditing', { count: result.applied_count }));
        } else if (result.moderation_required) {
          toast.info(t('gallery.batchCommentModerated', { count: result.applied_count }));
        } else {
          toast.success(t('gallery.batchCommentAdded', { count: result.applied_count }));
        }
      }
      if (result.failed_photo_ids.length) {
        toast.error(t('gallery.batchPartialFailure', { count: result.failed_photo_ids.length }));
      }
      if (feedbackType === 'comment' && result.failed_photo_ids.length === 0) {
        setComment('');
        setCommentOpen(false);
      }
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      const status = error?.response?.status;
      toast.error(status === 429
        ? t('feedback.rateLimited')
        : status === 401
          ? t('gallery.batchIdentityRequired')
          : t('gallery.batchActionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('gallery.batchActionsTitle', { count: photoIds.length })}</span>
        {colorLabelsEnabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void submit('color_label')}>
            {t('gallery.batchMarkForEditing')}
          </Button>
        )}
        {commentsEnabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setCommentOpen(value => !value)}>
            {t('gallery.batchComment')}
          </Button>
        )}
        {busy && <span className="text-xs text-neutral-500">{t('gallery.batchSubmitting')}</span>}
      </div>
      {commentsEnabled && photoIds.length > 20 && <p className="text-xs text-amber-700">{t('gallery.batchCommentLimit')}</p>}
      {colorLabelsEnabled && photoIds.length > 100 && <p className="text-xs text-amber-700">{t('gallery.batchMarkLimit')}</p>}
      {commentOpen && commentsEnabled && (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={3}
            aria-label={t('gallery.batchCommentPlaceholder')}
            placeholder={t('gallery.batchCommentPlaceholder')}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-transparent p-2 text-sm"
          />
          {requireNameEmail && !isGuestMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={t('feedback.yourName')} className="rounded-md border border-neutral-300 dark:border-neutral-600 bg-transparent p-2 text-sm" />
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder={t('feedback.yourEmail')} className="rounded-md border border-neutral-300 dark:border-neutral-600 bg-transparent p-2 text-sm" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCommentOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy || !comment.trim()} onClick={() => void submit('comment')}>{t('gallery.batchCommentSubmit')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
