const express = require('express');
const request = require('supertest');

jest.mock('../../src/database/db', () => ({ db: jest.fn() }));

const { db } = require('../../src/database/db');
const router = require('../../src/routes/publicCMS');

describe('public CMS language selection', () => {
  let app;
  let page;

  beforeEach(() => {
    page = {
      slug: 'gallery-not-found',
      title_en: 'Gallery Not Found',
      content_en: '<p>Contact the photographer.</p>',
      title_zh: '选片项目不存在',
      content_zh: '<p>请联系摄影师确认。</p>',
      title_de: 'Galerie nicht gefunden',
      content_de: '<p>Bitte kontaktieren.</p>',
      show_in_footer: false,
    };
    db.mockReturnValue({
      where: jest.fn().mockReturnValue({ first: jest.fn().mockImplementation(async () => page) }),
    });
    app = express();
    app.use('/api/public', router);
  });

  afterEach(() => jest.clearAllMocks());

  it('serves Simplified Chinese content for Chinese regional tags', async () => {
    const response = await request(app).get('/api/public/pages/gallery-not-found?lang=zh-SG');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: '选片项目不存在', content: '<p>请联系摄影师确认。</p>' });
  });

  it('falls back to English for retired and unsupported language codes', async () => {
    const response = await request(app).get('/api/public/pages/gallery-not-found?lang=de');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: 'Gallery Not Found', content: '<p>Contact the photographer.</p>' });
  });

  it('uses English content when an older page has no Chinese translation yet', async () => {
    page.title_zh = null;
    page.content_zh = null;
    const response = await request(app).get('/api/public/pages/gallery-not-found?lang=zh-CN');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: 'Gallery Not Found', content: '<p>Contact the photographer.</p>' });
  });
});
