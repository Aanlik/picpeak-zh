/**
 * Containment for the two admin-writable "delete the old file" paths.
 *
 * Settings → Branding persists logo_url / favicon_url verbatim and, on
 * clear, unlinked `path.join(storage, url)` after a mere prefix check.
 * Business profile did the same for logo_path behind a `/pdf-logo-\d+\./`
 * marker. Both let an admin delete any file the process can reach. The
 * helpers below only ever name a flat leaf inside the fixed directory.
 */
const path = require('path');
const { uploadedAssetPath, isPublicUploadImage } = require('../../src/utils/safePath');

const root = '/srv/picpeak/storage';

describe('uploadedAssetPath', () => {
  it('resolves a flat leaf inside the named upload directory', () => {
    expect(uploadedAssetPath('/uploads/logos/logo-1.png', 'logos', root))
      .toBe(path.join(root, 'uploads', 'logos', 'logo-1.png'));
    expect(uploadedAssetPath('/uploads/favicons/fav.ico', 'favicons', root))
      .toBe(path.join(root, 'uploads', 'favicons', 'fav.ico'));
  });

  it.each([
    '/uploads/logos/../../../data/picpeak.db',
    '/uploads/logos/..',
    '/uploads/logos/',
    '/uploads/logos/sub/dir.png',
    '/uploads/favicons/x.ico', // wrong kind
    'uploads/logos/logo.png', // not /-rooted
    'https://example.com/uploads/logos/logo.png',
    '',
    null,
    42,
  ])('refuses %p', (value) => {
    expect(uploadedAssetPath(value, 'logos', root)).toBeNull();
  });
});

describe('isPublicUploadImage', () => {
  it.each(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'fav.ico'])('allows %p', (name) => {
    expect(isPublicUploadImage(name)).toBe(true);
  });

  it.each(['a.html', 'a.js', 'a.svgz', 'a.pdf', 'noext', '', null])('refuses %p', (name) => {
    expect(isPublicUploadImage(name)).toBe(false);
  });
});
