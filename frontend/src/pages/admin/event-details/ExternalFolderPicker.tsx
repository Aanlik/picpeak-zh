import { NO_EMAIL_MODE } from '../../../config/communication';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderTreeNode } from './FolderTreeNode';

export const ExternalFolderPicker: React.FC<{ value: string; onChange: (p: string) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();

  // Seed expanded paths so the current selection (and the synthetic root) is visible on mount.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const set = new Set<string>(['']);
    if (value) {
      const parts = value.split('/').filter(Boolean);
      let acc = '';
      for (const seg of parts) {
        acc = acc ? `${acc}/${seg}` : seg;
        set.add(acc);
      }
    }
    return set;
  });

  const toggleExpand = (p: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  return (
    <div className="mt-2 border border-neutral-200 dark:border-neutral-700 rounded-lg p-2">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate">
          {NO_EMAIL_MODE ? '已选 NAS 文件夹' : t('common.selected', 'Selected')}: {NO_EMAIL_MODE ? value || '尚未选择' : `/external-media/${value}`}
        </div>
        {value && (
          <button
            type="button"
            className="text-xs underline text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 flex-shrink-0"
            onClick={() => onChange('')}
          >
            {t('events.clearSelection', 'Clear')}
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-auto [color-scheme:light] dark:[color-scheme:dark]">
        <FolderTreeNode
          path=""
          name={NO_EMAIL_MODE ? 'NAS 照片文件夹' : '/external-media'}
          depth={0}
          value={value}
          onChange={onChange}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
        />
      </div>
    </div>
  );
};
