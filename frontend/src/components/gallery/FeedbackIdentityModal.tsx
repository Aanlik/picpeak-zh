import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../common';

interface FeedbackIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  feedbackType: string;
}

export const FeedbackIdentityModal: React.FC<FeedbackIdentityModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  feedbackType,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('feedback.nameRequired', 'Name is required'));
      return;
    }
    onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-black/10 rounded-lg transition-colors">
          <X className="w-5 h-5 text-muted-theme" />
        </button>
        <h2 className="text-lg font-semibold text-theme mb-2">
          {t('feedback.identityRequired', 'Your Information Required')}
        </h2>
        <p className="text-sm text-muted-theme mb-4">
          {t('feedback.identityReason', 'Please provide your name to submit {{type}}.', { type: feedbackType })}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('feedback.yourName', 'Your Name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={error}
            placeholder={t('feedback.namePlaceholder', 'Enter your name')}
            required
          />
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1">
              {t('feedback.submitFeedback', 'Submit Feedback')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
