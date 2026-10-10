import React from 'react';
import { X, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../common';

interface PublishGalleryDialogProps {
  eventName: string;
  isPublishing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const PublishGalleryDialog: React.FC<PublishGalleryDialogProps> = ({
  eventName,
  isPublishing,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {t('events.publishDialog.title', '发布选片项目')}
          </h2>
          <button onClick={onClose} aria-label={t('common.close', '关闭')} className="text-neutral-400 hover:text-neutral-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-6 text-neutral-600 dark:text-neutral-400">
          {t('events.publishDialog.descriptionShareLink', { eventName, defaultValue: '发布“{{eventName}}”后，客户即可通过分享链接访问。' })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>{t('common.cancel', '取消')}</Button>
          <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} isLoading={isPublishing} onClick={onConfirm}>
            {t('events.publishDialog.publish', '发布项目')}
          </Button>
        </div>
      </Card>
    </div>
  );
};
