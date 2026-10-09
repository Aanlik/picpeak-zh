import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ArrowLeft, AlertTriangle, Calendar, MapPin, Save, Trash2 } from 'lucide-react';
import { Button, Card, CountrySelect, Input, Loading } from '../../components/common';
import { AssignedEventsDialog } from '../../components/admin/AssignedEventsDialog';
import { customerAdminService, type CustomerAccountDetail } from '../../services/customerAdmin.service';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { useModal } from '../../hooks';

type EditableFields = Pick<CustomerAccountDetail,
  'email' | 'displayName' | 'firstName' | 'lastName' | 'phone' | 'companyName' |
  'addressLine1' | 'addressLine2' | 'postalCode' | 'city' | 'state' | 'countryCode' |
  'preferredLanguage' | 'notes'>;

/** Customer identity, contact details, and gallery access. */
export const CustomerDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const customerId = Number(id);
  const { format: fmtDate } = useLocalizedDate();
  const assignedDialog = useModal();
  const [form, setForm] = useState<Partial<EditableFields>>({});

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ['admin-customer', customerId],
    queryFn: () => customerAdminService.get(customerId),
    enabled: Number.isFinite(customerId) && customerId > 0,
  });

  useEffect(() => {
    if (customer && Object.keys(form).length === 0) {
      setForm({
        email: customer.email,
        displayName: customer.displayName,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        companyName: customer.companyName,
        addressLine1: customer.addressLine1,
        addressLine2: customer.addressLine2,
        postalCode: customer.postalCode,
        city: customer.city,
        state: customer.state,
        countryCode: customer.countryCode,
        preferredLanguage: customer.preferredLanguage,
        notes: customer.notes,
      });
    }
  }, [customer, form]);

  const saveMutation = useMutation({
    mutationFn: () => customerAdminService.update(customerId, form),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-customer', customerId], updated);
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      toast.success(t('customers.detail.saved', 'Customer saved'));
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || t('customers.detail.saveError', 'Could not save changes.')),
  });

  const stateMutation = useMutation({
    mutationFn: (active: boolean) => active
      ? customerAdminService.reactivate(customerId)
      : customerAdminService.deactivate(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
    },
    onError: () => toast.error(t('customers.detail.saveError', 'Could not update customer.')),
  });

  const eraseMutation = useMutation({
    mutationFn: () => customerAdminService.erase(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
      toast.success(t('customers.erase.success', 'Customer data erased'));
      navigate('/admin/customers');
    },
    onError: () => toast.error(t('customers.erase.error', 'Could not erase customer')),
  });

  const setField = (key: keyof EditableFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  if (isLoading) return <div className="flex justify-center py-16"><Loading /></div>;
  if (error || !customer) return <div className="container py-6 text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{t('customers.detail.loadError', 'Could not load customer')}</div>;

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/customers" className="p-2 -ml-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700" aria-label={t('common.back', 'Back')}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 truncate">{customer.displayName || customer.email}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{customer.email}</p>
        </div>
        <span className={`text-xs ${customer.isActive ? 'text-green-700' : 'text-red-600'}`}>
          {customer.isActive ? t('customers.status.active', 'Active') : t('customers.status.inactive', 'Deactivated')}
        </span>
      </div>

      <Card padding="lg">
        <h2 className="text-lg font-semibold mb-4">{t('customers.detail.personalSection', 'Customer information')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm">{t('customers.detail.email', 'Email')}<Input type="email" value={form.email || ''} onChange={setField('email')} /></label>
          <label className="text-sm">{t('customers.detail.displayName', 'Display name')}<Input value={form.displayName || ''} onChange={setField('displayName')} /></label>
          <label className="text-sm">{t('customers.detail.firstName', 'First name')}<Input value={form.firstName || ''} onChange={setField('firstName')} /></label>
          <label className="text-sm">{t('customers.detail.lastName', 'Last name')}<Input value={form.lastName || ''} onChange={setField('lastName')} /></label>
          <label className="text-sm">{t('customers.detail.phone', 'Phone')}<Input value={form.phone || ''} onChange={setField('phone')} /></label>
          <label className="text-sm">{t('customers.detail.company', 'Company')}<Input value={form.companyName || ''} onChange={setField('companyName')} /></label>
          <label className="text-sm">{t('customers.detail.preferredLanguage', 'Preferred language')}<Input value={form.preferredLanguage || ''} onChange={setField('preferredLanguage')} /></label>
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><MapPin className="w-4 h-4" />{t('customers.detail.addressSection', 'Address')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm md:col-span-2">{t('customers.detail.addressLine1', 'Address line 1')}<Input value={form.addressLine1 || ''} onChange={setField('addressLine1')} /></label>
          <label className="text-sm md:col-span-2">{t('customers.detail.addressLine2', 'Address line 2')}<Input value={form.addressLine2 || ''} onChange={setField('addressLine2')} /></label>
          <label className="text-sm">{t('customers.detail.postalCode', 'Postal code')}<Input value={form.postalCode || ''} onChange={setField('postalCode')} /></label>
          <label className="text-sm">{t('customers.detail.city', 'City')}<Input value={form.city || ''} onChange={setField('city')} /></label>
          <label className="text-sm">{t('customers.detail.state', 'State / region')}<Input value={form.state || ''} onChange={setField('state')} /></label>
          <CountrySelect label={t('customers.detail.country', 'Country') as string} value={form.countryCode || ''} onChange={(countryCode) => setForm((prev) => ({ ...prev, countryCode }))} />
        </div>
      </Card>

      <Card padding="lg">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Calendar className="w-4 h-4" />{t('customers.detail.eventsSection', 'Assigned galleries')}</h2>
          <Button variant="outline" size="sm" onClick={() => assignedDialog.open()} disabled={!customer.isActive}>{t('customers.detail.manageEvents', 'Manage galleries')}</Button>
        </div>
        {customer.events.length ? <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">{customer.events.map((ev) => (
          <li key={ev.id} className="py-2 flex justify-between gap-3"><Link to={`/admin/events/${ev.id}`} className="hover:underline">{ev.eventName}</Link><span className="text-xs text-neutral-500">{ev.eventDate ? fmtDate(ev.eventDate) : ''}</span></li>
        ))}</ul> : <p className="text-sm text-neutral-500">{t('customers.detail.noEvents', 'Not assigned to any galleries yet.')}</p>}
      </Card>

      <Card padding="lg">
        <h2 className="text-lg font-semibold mb-3">{t('customers.detail.notesSection', 'Internal notes')}</h2>
        <textarea value={form.notes || ''} onChange={setField('notes')} rows={4} className="input w-full" />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" leftIcon={<Save className="w-4 h-4" />} isLoading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{t('common.save', 'Save')}</Button>
        <Button variant="outline" onClick={() => stateMutation.mutate(!customer.isActive)} disabled={stateMutation.isPending}>
          {customer.isActive ? t('customers.deactivate.button', 'Deactivate customer') : t('customers.reactivate.button', 'Reactivate customer')}
        </Button>
        {!customer.isActive && <Button variant="outline" leftIcon={<Trash2 className="w-4 h-4" />} isLoading={eraseMutation.isPending} onClick={() => {
          if (window.confirm(t('customers.erase.confirm', 'Erase this customer’s personal data? This cannot be undone.'))) eraseMutation.mutate();
        }}>{t('customers.erase.button', 'Erase customer data')}</Button>}
      </div>

      <AssignedEventsDialog customerId={customer.id} isOpen={assignedDialog.isOpen} initial={customer.events.map((ev) => ({ id: ev.id, eventName: ev.eventName, eventDate: ev.eventDate || null }))} onClose={() => assignedDialog.close()} onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-customer', customerId] })} />
    </div>
  );
};

CustomerDetailPage.displayName = 'CustomerDetailPage';
