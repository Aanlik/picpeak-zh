import type { Photo } from '../../types';

/** Keep only selected photos the current gallery view can actually download. */
export const getDownloadableSelectedPhotoIds = (
  photos: Photo[],
  selectedPhotoIds: Set<number>,
): number[] => photos
  .filter((photo) => selectedPhotoIds.has(photo.id) && photo.category_allow_downloads !== false)
  .map((photo) => photo.id);
