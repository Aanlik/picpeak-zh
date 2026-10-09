const { filterDeliveredPhotoEntries } = require('../archiveService');

describe('Bridge project archive contents', () => {
  it('keeps only the managed photo rows marked as delivered', () => {
    const event = { slug: 'portrait', source_mode: 'managed' };
    const photos = [
      { id: 1, path: 'events/active/portrait/individual/proof.jpg' },
      { id: 2, path: 'events/active/portrait/individual/retouched.jpg' },
      { id: 3, path: 'events/active/portrait/individual/not-delivered.jpg' },
    ];
    const entries = photos.map((photo) => ({ key: photo.path }));

    expect(filterDeliveredPhotoEntries(event, photos, new Set([2]), entries))
      .toEqual([{ key: 'events/active/portrait/individual/retouched.jpg' }]);
  });

  it('leaves ordinary non-Bridge archives unchanged', () => {
    const entries = [{ key: 'events/active/portrait/individual/proof.jpg' }];
    expect(filterDeliveredPhotoEntries({}, [], null, entries)).toBe(entries);
  });
});
