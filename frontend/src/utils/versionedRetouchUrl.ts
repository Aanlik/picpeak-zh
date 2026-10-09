/** Add the current delivery version to same-origin image URLs so browser and
 * intermediary caches fetch the replaced preview after a retouch is delivered. */
export function versionedRetouchUrl(url: string | null | undefined, version: number): string | undefined {
  if (!url || version < 1 || !url.startsWith('/')) return url || undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('retouch_v', String(version));
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
