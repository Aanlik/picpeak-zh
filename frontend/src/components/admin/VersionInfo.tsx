import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { api } from '../../config/api';
import packageJson from '../../../package.json';

interface SystemVersion {
  backend: string;
  frontend: string;
  node: string;
  environment: string;
}

async function fetchSystemVersion(): Promise<SystemVersion> {
  const response = await api.get<SystemVersion>('/admin/system/version');
  return response.data;
}

export const VersionInfo: React.FC = () => {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['system-version'], queryFn: fetchSystemVersion, staleTime: 5 * 60 * 1000 });
  return (
    <div className="px-4 py-3 border-t border-neutral-200">
      <div className="flex items-center gap-2 text-xs text-neutral-600">
        <Info className="w-3 h-3" />
        <span className="font-medium">{t('admin.version', 'Version')}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
        <div>{t('ui.frontend', 'Frontend')} v{packageJson.version}</div>
        {data && <div>{t('ui.backend', 'Backend')} v{data.backend}</div>}
      </div>
    </div>
  );
};
