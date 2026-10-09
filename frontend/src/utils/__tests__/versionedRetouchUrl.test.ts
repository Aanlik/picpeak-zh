import { describe, expect, it } from 'vitest';
import { versionedRetouchUrl } from '../versionedRetouchUrl';

describe('versionedRetouchUrl', () => {
  it('changes the browser cache key when a new retouched version is delivered', () => {
    expect(versionedRetouchUrl('/api/gallery/photos/25/preview?width=1600', 3))
      .toBe('/api/gallery/photos/25/preview?width=1600&retouch_v=3');
  });

  it('preserves existing query parameters and fragments', () => {
    expect(versionedRetouchUrl('/photos/25?token=abc#view', 4))
      .toBe('/photos/25?token=abc&retouch_v=4#view');
  });

  it('leaves non-gallery URLs and unversioned proofs unchanged', () => {
    expect(versionedRetouchUrl('https://cdn.example.com/photo.jpg', 2)).toBe('https://cdn.example.com/photo.jpg');
    expect(versionedRetouchUrl('/api/gallery/photos/25/preview', 0)).toBe('/api/gallery/photos/25/preview');
  });
});
