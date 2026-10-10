import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Lock, UserRound } from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { Button, Input, Card, PoweredBy } from '../../components/common';
import { useAdminAuth } from '../../contexts';
import { authService } from '../../services/auth.service';
import { setupService } from '../../services/setup.service';
import { usePublicSettings } from '../../hooks/usePublicSettings';
import { useAdminDarkMode } from '../../contexts/AdminDarkModeContext';
import { resolveLoginLogoClasses } from '../../utils/loginLogoSize';
import { buildResourceUrl } from '../../utils/url';
import { api } from '../../config/api';

export const AdminLoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated, login } = useAdminAuth();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState(false);
  const { data: settingsData } = usePublicSettings();
  const { isDark } = useAdminDarkMode();
  const companyName = settingsData?.branding_company_name?.trim() || 'PicPeak';
  const lightLogo = settingsData?.branding_logo_url?.trim();
  const darkLogo = settingsData?.branding_logo_url_dark?.trim();
  const framed = settingsData?.branding_login_logo_frame_enabled !== false;
  const logo = framed ? (lightLogo || darkLogo) : (isDark ? darkLogo || lightLogo : lightLogo || darkLogo);
  const logoUrl = logo || '/picpeak-logo-transparent.png';

  useEffect(() => {
    if (searchParams.get('session') === 'expired') toast.info(t('adminLogin.sessionExpired'));
    const ssoError = searchParams.get('sso_error');
    if (ssoError) {
      const known = ['config', 'state', 'idp', 'inactive', 'not_provisioned', 'no_email', 'no_role'];
      toast.error(t(`adminLogin.ssoErrors.${known.includes(ssoError) ? ssoError : 'idp'}`));
    }
  }, [searchParams, t]);

  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'], queryFn: setupService.getSetupStatus, retry: false, staleTime: Infinity,
  });
  if (setupStatus?.needsAdmin) return <Navigate to="/setup" replace />;
  if (isAuthenticated || loginSuccess) return <Navigate to="/admin/dashboard" replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    toast.dismiss();
    setError('');
    if (!username.trim()) { setError(t('adminLogin.usernameRequired')); return; }
    if (!password) { setError(t('adminLogin.passwordRequired')); return; }
    setIsLoading(true);
    try {
      const response = await authService.adminLogin({ username: username.trim(), password, rememberMe });
      login(response.token, response.user);
      toast.success(t('adminLogin.loginSuccess'));
      setLoginSuccess(true);
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || err.code === 'ERR_CONNECTION_RESET') {
        try {
          const session = await api.get<{ valid: boolean; type: string }>('/auth/session');
          if (session.data?.valid && session.data.type === 'admin') { setLoginSuccess(true); return; }
        } catch { /* Surface the original connection error. */ }
        toast.error(t('adminLogin.networkError'));
      } else if (err.response?.status === 429 || err.response?.status === 423) {
        toast.error(t('adminLogin.tooManyAttempts'));
      } else if (err.response?.status === 401) {
        setError(t('adminLogin.invalidCredentials'));
      } else {
        toast.error(t('adminLogin.generalError'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-background, #fafafa)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {framed ? (
            <div className={`${resolveLoginLogoClasses(settingsData?.branding_login_logo_size).frameOuter} mx-auto mb-6 rounded-2xl flex items-center justify-center`} style={{ backgroundColor: '#eee6d2' }}>
              <img src={logoUrl} alt={companyName} className={`${resolveLoginLogoClasses(settingsData?.branding_login_logo_size).frameInner} object-contain`} />
            </div>
          ) : (
            <img src={logoUrl} alt={companyName} className={`${resolveLoginLogoClasses(settingsData?.branding_login_logo_size).bare} object-contain mx-auto mb-6`} />
          )}
          <h1 className="text-3xl font-bold" style={{ color: 'var(--color-text, #171717)' }}>{t('adminLogin.title')}</h1>
          <p className="mt-2" style={{ color: 'var(--color-text, #171717)', opacity: 0.7 }}>{t('adminLogin.subtitle')}</p>
        </div>
        <Card padding="lg">
          {settingsData?.oidc_enabled === true && settingsData?.oidc_local_login_disabled === true ? (
            <div className="space-y-6">
              <p className="text-sm text-center text-neutral-600">{t('adminLogin.ssoOnlyHint', 'Password login is disabled on this instance — sign in through your identity provider.')}</p>
              <Button type="button" variant="primary" size="lg" className="w-full" onClick={() => { window.location.href = buildResourceUrl('/api/auth/admin/sso/login'); }}>
                {settingsData.oidc_button_label?.trim() || t('adminLogin.ssoSignIn', 'Sign in with SSO')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"><AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" /><p className="text-sm text-red-800">{error}</p></div>}
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-neutral-700 mb-1">{t('adminLogin.usernameLabel')}</label>
                <Input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('adminLogin.usernamePlaceholder')} leftIcon={<UserRound className="w-5 h-5 text-neutral-400" />} autoComplete="username" autoFocus />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-1">{t('adminLogin.passwordLabel')}</label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('adminLogin.passwordPlaceholder')} leftIcon={<Lock className="w-5 h-5 text-neutral-400" />} autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-600" tabIndex={-1} aria-label={showPassword ? t('adminLogin.hidePassword') : t('adminLogin.showPassword')}>
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <label className="flex items-center"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 text-accent border-neutral-300 rounded focus:ring-primary-500" /><span className="ml-2 text-sm text-neutral-700">{t('adminLogin.rememberMe')}</span></label>
              <Button type="submit" variant="primary" size="lg" isLoading={isLoading} className="w-full">{t('adminLogin.signIn')}</Button>
              {settingsData?.oidc_enabled === true && <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => { window.location.href = buildResourceUrl('/api/auth/admin/sso/login'); }}>{settingsData.oidc_button_label?.trim() || t('adminLogin.ssoSignIn', 'Sign in with SSO')}</Button>}
            </form>
          )}
        </Card>
        <div className="text-center mt-8"><PoweredBy className="text-xs mt-2" style={{ color: 'var(--color-text, #171717)', opacity: 0.5 }} /></div>
        {import.meta.env.DEV && <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg"><p className="text-sm text-blue-800 text-center">{t('adminLogin.devModeHint')}</p></div>}
      </div>
    </div>
  );
};

AdminLoginPage.displayName = 'AdminLoginPage';
