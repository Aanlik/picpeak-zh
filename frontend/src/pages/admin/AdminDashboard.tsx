import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useExpiryRefresh } from '../../hooks/useExpiryRefresh';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { Button, Card, Loading } from '../../components/common';
import { eventsService } from '../../services/events.service';

export const AdminDashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { format } = useLocalizedDate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-events-summary', 'expiring'],
    queryFn: () => eventsService.getEvents(1, 5, 'expiring', undefined, 'expires_at', 'asc'),
  });
  const refreshExpiring = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-events-summary', 'expiring'] });
  }, [queryClient]);
  useExpiryRefresh((data?.events ?? []).map((event: any) => event.expires_at), refreshExpiring);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loading size="lg" text={t('admin.loadingDashboard')} /></div>;
  }

  const events = data?.events ?? [];
  const total = data?.pagination?.total ?? events.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('navigation.dashboard')}</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">{t('admin.dashboardSubtitle')}</p>
        </div>
        <Button variant="primary" leftIcon={<Plus className="w-5 h-5" />} onClick={() => navigate('/admin/events/new')}>
          {t('events.createEvent')}
        </Button>
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('admin.eventsExpiringSoon')}</h2>
          <AlertTriangle className="w-5 h-5 text-orange-600" />
        </div>
        {events.length === 0 ? (
          <p className="text-neutral-600 dark:text-neutral-400 py-8 text-center">{t('admin.noEventsExpiring')}</p>
        ) : (
          <div className="space-y-3">
            {events.map((event: any) => {
              const expiry = parseISO(event.expires_at!);
              const daysLeft = Math.max(1, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
              return (
                <button
                  key={event.id}
                  type="button"
                  className="w-full flex items-center justify-between p-4 text-left bg-orange-50 dark:bg-orange-900/30 rounded-lg border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors"
                  onClick={() => navigate(`/admin/events/${event.id}`)}
                >
                  <span>
                    <span className="block font-medium text-neutral-900 dark:text-neutral-100">{event.event_name}</span>
                    {event.event_date && <span className="block text-sm text-neutral-600 dark:text-neutral-400">{format(parseISO(event.event_date), 'PP')}</span>}
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium text-orange-600 dark:text-orange-400">{t('admin.daysLeft', { count: daysLeft })}</span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">{t('gallery.expires')} {format(expiry, 'PP')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {total > 5 && (
          <button type="button" onClick={() => navigate('/admin/events?filter=expiring')} className="w-full mt-4 text-sm text-accent hover:opacity-80 font-medium">
            {t('admin.viewAllExpiringEvents', { count: total })} →
          </button>
        )}
      </Card>
    </div>
  );
};

AdminDashboard.displayName = 'AdminDashboard';
