/**
 * clientIp — resolve the originating client IP for audit-trail
 * recording on public actions.
 *
 * **Why this helper exists:** the public-facing routes used to read
 * `req.headers['x-forwarded-for']` directly and take the first
 * comma-segment as the source IP. That bypasses Express's `trust
 * proxy` safety net entirely — any direct (non-proxied) request can
 * spoof the audit IP by setting the header.
 *
 * **Correct path:** trust ONLY `req.ip`, and rely on
 * `app.set('trust proxy', ...)` in `server.js` to populate it
 * correctly. Express's trust-proxy machinery is the only thing that
 * knows which upstream hops are trustworthy. The default in
 * `server.js` (`'loopback, linklocal, uniquelocal'`) is correct for
 * picpeak's standard deployment (nginx in front, Docker network);
 * operators with unusual topologies override via `TRUST_PROXY` env.
 *
 * **Returns:** the resolved IPv4/IPv6 string, or `null` when Express
 * couldn't determine one (very rare — happens with abusive raw
 * sockets / malformed connections).
 *
 * **Storage:** call sites decide whether an IP should be persisted.
 * This helper only resolves the trusted client address.
 */
function clientIpForAudit(req) {
  if (!req) return null;
  return req.ip || null;
}

module.exports = { clientIpForAudit };
