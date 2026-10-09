'use strict';
const NO_EMAIL_MODE = process.env.NO_EMAIL_MODE === 'true';
const EMAIL_FEATURES = new Set(['messaging', 'incomingMail', 'reminderEmails', 'customerPortal', 'transfers']);
function project(value) {
  if (Array.isArray(value)) return value.map(project);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => {
    if (typeof v === 'string' && (key === 'email' || key.endsWith('_email') || key.endsWith('Email'))) return [key, ''];
    if (key === 'actorName' && typeof v === 'string' && v.includes('@')) return [key, v.split('@')[0]];
    if (EMAIL_FEATURES.has(key)) return [key, false];
    if (['event_require_customer_email', 'event_require_admin_email', 'require_name_email', 'require_email', 'guest_require_email'].includes(key)) return [key, false];
    if (key === 'identity_mode' && v === 'guest') return [key, 'simple'];
    return [key, project(v)];
  }));
}
function middleware(req, res, next) {
  if (!NO_EMAIL_MODE) return next();
  if (/\/(?:invitations|email|emails|messages|newsletters|incoming-mail)(?:\/|$)|\/(?:send-email|send-gallery-email|recover-request|recover-verify|reset-password-email)(?:\/|$)|\/admin\/users\/\d+\/reset-password$/.test(req.path)) {
    return res.status(409).json({ error: '此部署使用链接分享与本地账号，不提供邮件服务' });
  }
  if (req.body && typeof req.body === 'object') {
    for (const key of ['sendEmail', 'send_email', 'notify_customer', 'notifyCustomer', 'resendEmail', 'resend_email', 'require_name_email', 'require_email']) if (key in req.body) req.body[key] = false;
    if (req.body.identity_mode === 'guest') req.body.identity_mode = 'simple';
  }
  const json = res.json.bind(res);
  res.json = value => json(project(value));
  return next();
}
module.exports = { NO_EMAIL_MODE, EMAIL_FEATURES, project, middleware };
