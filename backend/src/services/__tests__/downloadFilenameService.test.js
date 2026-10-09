const { pickRawDownloadName, getZipEntryNames } = require('../downloadFilenameService');

describe('Bridge delivery download filenames', () => {
  const digest = 'a'.repeat(64);
  const delivered = {
    id: 12,
    filename: 'event-001-12.jpg',
    original_filename: `DSC00125.__bridge_${digest}.JPG`,
  };

  it('strips the private Bridge marker even when original names are disabled', () => {
    expect(pickRawDownloadName(delivered, false)).toBe('DSC00125.JPG');
    expect(pickRawDownloadName(delivered, true)).toBe('DSC00125.JPG');
  });

  it('uses the camera filename in download archives', () => {
    expect(getZipEntryNames([delivered], false)).toEqual(['DSC00125.JPG']);
  });
});
