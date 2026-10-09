import { describe, expect, it } from 'vitest';
import type { Photo } from '../../../types';
import { getDownloadableSelectedPhotoIds } from '../downloadSelection';

const photo = (id: number, category_allow_downloads?: boolean) => ({
  id,
  filename: `photo-${id}.jpg`,
  url: `/photo/${id}`,
  type: 'individual',
  size: 1,
  uploaded_at: '2026-01-01T00:00:00.000Z',
  category_allow_downloads,
}) as Photo;

describe('getDownloadableSelectedPhotoIds', () => {
  it('returns selected visible photos once and excludes categories with downloads disabled', () => {
    expect(getDownloadableSelectedPhotoIds([
      photo(1),
      photo(2, false),
      photo(3, true),
    ], new Set([1, 2, 3, 99]))).toEqual([1, 3]);
  });

  it('returns no ids when selection is empty or all selected photos are unavailable', () => {
    expect(getDownloadableSelectedPhotoIds([photo(1)], new Set())).toEqual([]);
    expect(getDownloadableSelectedPhotoIds([photo(2, false)], new Set([2]))).toEqual([]);
  });
});
