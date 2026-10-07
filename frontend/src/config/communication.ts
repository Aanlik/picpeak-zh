/** Thin-fork deployment profile; upstream behaviour remains available when disabled. */
export const NO_EMAIL_MODE = import.meta.env.VITE_NO_EMAIL_MODE === 'true';
export const EMAIL_FEATURES = new Set(['messaging', 'incomingMail', 'newsletters', 'reminderEmails', 'customerPortal', 'crmDevelopment', 'contracts', 'quotes', 'bills', 'transfers']);
