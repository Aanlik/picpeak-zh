const dns = require('dns').promises;
const net = require('net');
const ipaddr = require('ipaddr.js');
const { isPrivateIP } = require('./networkValidation');

function privateOrigins() {
  return new Set((process.env.INTEGRATION_PRIVATE_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('INTEGRATION_PRIVATE_ORIGINS must contain HTTP(S) origins only');
    return url.origin;
  }));
}

function assertAddress(address, allowPrivate) {
  let parsed;
  try { parsed = ipaddr.process(address); } catch { throw new Error('Invalid integration destination address'); }
  const range = parsed.range();
  // Even explicit private-origin exceptions never permit metadata/link-local,
  // unspecified, multicast, CGNAT, or IPv4 translation/reserved ranges.
  if (range === 'unicast' && !isPrivateIP(address)) return;
  if (allowPrivate && ['private', 'loopback', 'uniqueLocal'].includes(range)) return;
  throw new Error('Integration destination is not permitted; configure an explicit private origin for self-hosted services');
}

/** Native HTTP options used by openid-client requests.
 * Validate literals immediately; validate DNS inside the socket lookup itself,
 * passing only vetted answers to the connector (no second DNS lookup).
 * openid-client calls this as its `http_options(url, options)` hook.
 */
function integrationRequestOptions(value) {
  return buildRequestOptions(value, false);
}

function buildRequestOptions(value, alwaysAllowPrivate) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Integration URL must use HTTP(S) without embedded credentials');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const allowPrivate = alwaysAllowPrivate || privateOrigins().has(url.origin);
  if (['metadata.google.internal', 'metadata.google'].includes(hostname.toLowerCase().replace(/\.$/, ''))) {
    throw new Error('Metadata destinations are not permitted');
  }
  if (net.isIP(hostname)) assertAddress(hostname, allowPrivate);
  else if (isPrivateIP(hostname) && !allowPrivate) throw new Error('Private integration origin requires explicit approval in INTEGRATION_PRIVATE_ORIGINS');
  const lookup = (name, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (name !== hostname) return callback(new Error('Integration destination changed'));
    const family = typeof options === 'number' ? options : options?.family;
    dns.lookup(name, { all: true }).then(addresses => {
      if (!addresses.length) throw new Error('Integration destination did not resolve');
      for (const record of addresses) assertAddress(record.address, allowPrivate);
      const matches = family ? addresses.filter(record => record.family === family) : addresses;
      if (!matches.length) throw new Error('No permitted integration address for requested family');
      if (options?.all) callback(null, matches);
      else callback(null, matches[0].address, matches[0].family);
    }).catch(callback);
  };
  // Do not reuse sockets whose address decision came from a previous policy.
  return { lookup, agent: false };
}

module.exports = { integrationRequestOptions };
