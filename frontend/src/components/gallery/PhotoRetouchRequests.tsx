import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Button } from '../common';
import { galleryService } from '../../services/gallery.service';
import type { Photo } from '../../types';
import { useGuestIdentityOptional } from '../../contexts/GuestIdentityContext';

export function PhotoRetouchRequests({ slug, photo }: {
  slug: string;
  photo: Photo;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'revision' | 'additional'>(photo.retouch_state === 'delivered' ? 'revision' : 'additional');
  const [message, setMessage] = useState('');
  const guestIdentity = useGuestIdentityOptional();
  const workflow = useQuery({
    queryKey: ['gallery-retouch-workflow', slug],
    queryFn: () => galleryService.getRetouchWorkflow(slug),
    enabled: Boolean(photo.retouch_workflow_enabled),
    staleTime: 15000,
    refetchInterval: 30000,
    retry: false,
  });
  const ownRequests = useMemo(() => (workflow.data?.requests || []).filter((item) => item.photo_id === photo.id), [workflow.data?.requests, photo.id]);
  const submit = useMutation({
    mutationFn: async () => {
      if (guestIdentity?.identityMode === 'guest') await guestIdentity.ensureIdentity();
      return galleryService.submitRetouchRequest(slug, photo.id, {
        request_type: kind,
        ...(kind === 'revision' ? { base_version: photo.retouch_version || 1 } : {}),
        message,
      });
    },
    onSuccess: async (result) => {
      setMessage('');
      toast.success(result.moderation_required ? t('retouchRequest.moderation') : t('retouchRequest.submitted'));
      await queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] });
    },
    onError: (error: any) => {
      if (error?.message === 'user_cancelled') return;
      const code = error?.response?.data?.code;
      const key = code === 'VERSION_CHANGED' ? 'retouchRequest.versionChanged'
        : code === 'NO_DELIVERED_VERSION' ? 'retouchRequest.noVersion'
          : code === 'GUEST_IDENTITY_REQUIRED' ? 'retouchRequest.identityRequired'
            : 'retouchRequest.submitFailed';
      toast.error(t(key));
      if (code === 'VERSION_CHANGED') void queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] });
    },
  });

  if (!photo.retouch_workflow_enabled) return null;
  return <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700" aria-label={t('retouchRequest.title')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="font-medium">{t('retouchRequest.title')}</h4>
        <p className="mt-1 text-xs text-neutral-500">
          {t(`photographyWorkflow.clientState.${photo.retouch_state || 'proof'}`)}{photo.retouch_state === 'delivered' && photo.retouch_version ? ` · V${photo.retouch_version}` : ''}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>
        {open ? t('retouchRequest.closeForm') : t('retouchRequest.newRequest')}
      </Button>
    </div>
    <p className="mt-2 text-xs text-neutral-500">{t('retouchRequest.requestHint')}</p>
    {open && <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
      <label className="block space-y-1 text-sm">
        <span>{t('retouchRequest.kind')}</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as 'revision' | 'additional')} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
          <option value="revision" disabled={photo.retouch_state !== 'delivered'}>{t('retouchRequest.revisionOption', { version: photo.retouch_version || 1 })}</option>
          <option value="additional">{t('retouchRequest.additionalOption')}</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t('retouchRequest.message')}</span>
        <textarea required maxLength={1000} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('retouchRequest.messageHint')} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900" />
      </label>
      <Button type="submit" disabled={submit.isPending || !message.trim() || (kind === 'revision' && photo.retouch_state !== 'delivered')}>
        {submit.isPending ? t('retouchRequest.submitting') : t('retouchRequest.submit')}
      </Button>
    </form>}
    {ownRequests.length > 0 && <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-neutral-500">{t('retouchRequest.history')}</p>
      {ownRequests.slice(0, 4).map((item) => <div key={item.id} className="rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-800">
        <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
          <span>{t(`photographyWorkflow.requestType.${item.request_type}`)}{item.base_version ? ` · V${item.base_version}` : ''}</span>
          <span>{t(`photographyWorkflow.requestState.${item.status}`)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap">{item.customer_message}</p>
        {item.photographer_reply && <p className="mt-1 border-l-2 border-emerald-500 pl-2 text-neutral-600 dark:text-neutral-300">{item.photographer_reply}</p>}
      </div>)}
    </div>}
  </section>;
}
