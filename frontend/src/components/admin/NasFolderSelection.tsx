import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { externalMediaService } from '../../services/externalMedia.service';
import { ExternalFolderPicker } from '../../pages/admin/event-details/ExternalFolderPicker';
export function NasFolderSelection({ value, onChange, watch, onWatchChange }: {
  value: string; onChange: (path: string) => void; watch: boolean; onWatchChange: (watch: boolean) => void;
}) {
  const cache = useQueryClient();
  const preview = useQuery({ queryKey: ['external-folder-preview', value], queryFn: () => externalMediaService.list(value), enabled: !!value });
  return <div className="space-y-3">
    <p className="text-sm text-neutral-600 dark:text-neutral-400">选择 Camera 内对应的拍摄文件夹；按项目整理时可选择 02_PROOF。照片直接引用 NAS 原文件，不重复上传，也不会修改原文件。</p>
    <button type="button" className="text-sm underline" onClick={() => { void cache.invalidateQueries({ queryKey: ['external-folder-children'] }); void cache.invalidateQueries({ queryKey: ['external-folder-preview'] }); }}>刷新文件夹列表</button>
    <ExternalFolderPicker value={value} onChange={onChange} />
    {value && <p className="text-sm" role="status">{preview.isError ? '无法读取此文件夹，请检查挂载和读取权限。' : preview.isLoading ? '正在读取文件夹…' : `当前文件夹可导入 ${preview.data?.entries.filter(x => x.type === 'file').length ?? 0} 张照片（不含子文件夹）`}</p>}
    <p className="text-xs text-neutral-500">支持 JPG、JPEG、PNG、WebP；包含子文件夹。RAW 不进入客户相册。关联后请保留原文件的位置和文件名。</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={watch} onChange={e => onWatchChange(e.target.checked)} />自动导入此文件夹后续新增的照片</label>
  </div>;
}
