/** Contact details used by customer and project reminder messages. */

const { db, withRetry } = require('../database/db');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 60 * 1000;
let cache = { value: undefined, expiresAt: 0 };

function invalidateEmailSignatureCache() {
  cache = { value: undefined, expiresAt: 0 };
}

async function getEmailSignature() {
  const now = Date.now();
  if (cache.value !== undefined && cache.expiresAt > now) return cache.value;

  let value = null;
  try {
    const profile = await withRetry(() => db('business_profile').where({ id: 1 }).first());
    const enabled = profile && [true, 1, '1', 't', 'true'].includes(profile.email_signature_enabled);
    if (enabled) {
      const cc = profile.country_code ? String(profile.country_code).toUpperCase() : '';
      const pc = profile.postal_code || '';
      const cityLine = [cc && pc ? `${cc}-${pc}` : (pc || cc), profile.city || '', profile.country_name || '']
        .filter(Boolean).join(' ');
      value = {
        companyName: profile.company_name || '',
        addressLines: [profile.address_line1, profile.address_line2, cityLine]
          .map((line) => String(line || '').trim()).filter(Boolean),
        phone: profile.phone || '',
        mobile: profile.mobile || '',
        email: profile.email || '',
        website: profile.website || '',
      };
    }
  } catch (error) {
    logger.warn('Could not read customer message contact details', { error: error.message });
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

module.exports = { getEmailSignature, invalidateEmailSignatureCache };
