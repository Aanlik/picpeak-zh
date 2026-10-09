import { useTranslation } from 'react-i18next';
import type { Photo } from '../../types';

const stateClass: Record<NonNullable<Photo['retouch_state']>, string> = {
  proof: 'bg-neutral-900/80 text-white',
  selected: 'bg-sky-700/95 text-white',
  editing: 'bg-violet-700/95 text-white',
  delivered: 'bg-emerald-700/95 text-white',
  cancelled: 'bg-amber-700/95 text-white',
};

export function WorkflowStatusBadge({
  photo,
  position = 'top-2 right-2',
  compact = false,
}: {
  photo: Photo;
  position?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!photo.retouch_workflow_enabled || !photo.retouch_state) return null;

  const state = photo.retouch_state;
  const label = t(`photographyWorkflow.clientState.${state}`);
  const additional = photo.retouch_added_during_editing
    ? ` · ${t('photographyWorkflow.clientAdditionalSelection')}`
    : '';
  const version = state === 'delivered' && photo.retouch_version
    ? ` · V${photo.retouch_version}`
    : '';

  return (
    <span
      className={`absolute ${position} z-[3] max-w-[calc(100%-1rem)] truncate rounded-full font-semibold shadow-sm ring-1 ring-white/40 ${stateClass[state]} ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[11px]'}`}
      aria-label={`${label}${version}${additional}`}
      title={`${label}${version}${additional}`}
    >
      {label}{version}{additional}
    </span>
  );
}
