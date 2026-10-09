import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { externalMediaService } from '../../services/externalMedia.service';
import { ExternalFolderPicker } from '../../pages/admin/event-details/ExternalFolderPicker';
import { useTranslation } from 'react-i18next';
export function NasFolderSelection({ value, onChange, watch, onWatchChange }: {
  value: string; onChange: (path: string) => void; watch: boolean; onWatchChange: (watch: boolean) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const preview = useQuery({ queryKey: ['external-folder-preview', value], queryFn: () => externalMediaService.list(value), enabled: !!value });
  return <div className="space-y-3">
    <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('nasFolder.selectHelp')}</p>
    <button type="button" className="text-sm underline" onClick={() => { void cache.invalidateQueries({ queryKey: ['external-folder-children'] }); void cache.invalidateQueries({ queryKey: ['external-folder-preview'] }); }}>{t('nasFolder.refresh')}</button>
    <ExternalFolderPicker value={value} onChange={onChange} />
    {value && <p className="text-sm" role="status">{preview.isError ? t('nasFolder.readError') : preview.isLoading ? t('nasFolder.reading') : t('nasFolder.availableCount', { count: preview.data?.entries.filter(x => x.type === 'file').length ?? 0 })}</p>}
    <p className="text-xs text-neutral-500">{t('nasFolder.formatHelp')}</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={watch} onChange={e => onWatchChange(e.target.checked)} />{t('nasFolder.autoImport')}</label>
  </div>;
}
