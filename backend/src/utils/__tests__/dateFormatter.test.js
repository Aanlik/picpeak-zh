jest.mock('../../database/db', () => ({ db: jest.fn() }));

const { db } = require('../../database/db');
const { formatDate } = require('../dateFormatter');

describe('dateFormatter language handling', () => {
  const date = new Date(2026, 1, 3, 12, 0, 0);

  beforeEach(() => {
    db.mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue({
          setting_value: JSON.stringify({ format: 'DD.MM.YYYY', locale: 'de-DE' }),
        }),
      }),
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('honors the configured date order without relying on a regional language locale', async () => {
    await expect(formatDate(date, 'de')).resolves.toBe('03.02.2026');
    await expect(formatDate(date, 'zh-CN')).resolves.toBe('03.02.2026');
  });

  it('uses Chinese or English only for long date names', async () => {
    db.mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue({
          setting_value: JSON.stringify({ format: 'long', locale: 'de-DE' }),
        }),
      }),
    });

    await expect(formatDate(date, 'zh-SG')).resolves.toContain('年');
    await expect(formatDate(date, 'de')).resolves.toBe('February 3, 2026');
  });
});
