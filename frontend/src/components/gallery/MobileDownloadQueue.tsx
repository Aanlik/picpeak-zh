import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_DOWNLOAD_EVENT, type MobileDownloadItem } from '../../utils/mobileDownloads';

/** A separate tap per file preserves browser user activation on mobile. */
export function MobileDownloadQueue() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MobileDownloadItem[]>([]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  useEffect(() => {
    const receive = (event: Event) => {
      setItems((event as CustomEvent<MobileDownloadItem[]>).detail);
      setOpened(new Set());
    };
    window.addEventListener(MOBILE_DOWNLOAD_EVENT, receive);
    return () => window.removeEventListener(MOBILE_DOWNLOAD_EVENT, receive);
  }, []);
  if (!items.length) return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <section role="dialog" aria-modal="true" aria-label={t('mobileDownload.title')} className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl">
      <h2 className="text-lg font-semibold">{t('mobileDownload.title')}</h2>
      <p className="my-3 text-sm">{t('mobileDownload.instructions')}</p>
      <ul className="space-y-2">{items.map((item, index) => <li key={item.photoId}>
        <a className="block rounded-lg border p-3 text-blue-700" href={item.href} download
          onClick={() => setOpened(previous => new Set(previous).add(item.photoId))}>
          {t('mobileDownload.file', { number: index + 1 })}{opened.has(item.photoId) ? ` · ${t('mobileDownload.opened')}` : ''}
        </a>
      </li>)}</ul>
      <button className="mt-4 rounded-lg border px-4 py-2" onClick={() => setItems([])}>{t('common.close')}</button>
    </section>
  </div>;
}
