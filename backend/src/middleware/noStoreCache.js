/**
 * Cache-Control: no-store helper for sensitive endpoints.
 *
 * Apply `Cache-Control: no-store` to session-bearing and other sensitive
 * responses. This prevents browsers and intermediate caches from retaining
 * credentials, private data, or transient authorization errors.
 *
 * No-op cost (one setHeader per request); applied per route group
 * rather than globally so static assets + galleries keep their
 * own caching strategy.
 */

function noStoreCache(req, res, next) {
  // `no-store` is the strongest signal — no cache, no revalidation,
  // no offline retention. Pair with `private` so any well-behaved
  // intermediate proxy treats the response as user-specific.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache'); // HTTP/1.0 fallback for older proxies
  res.setHeader('Expires', '0');
  next();
}

module.exports = { noStoreCache };
