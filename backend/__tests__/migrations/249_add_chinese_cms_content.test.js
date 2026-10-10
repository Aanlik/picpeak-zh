const knexFactory = require('knex');
const migration = require('../../migrations/core/249_add_chinese_cms_content');

describe('Chinese CMS content migration', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('cms_pages', (table) => {
      table.increments('id').primary();
      table.string('slug').unique();
      table.text('title_en');
      table.text('title_de');
      table.text('content_en');
      table.text('content_de');
      table.text('logo_url');
    });
    await db('cms_pages').insert([
      { slug: 'gallery-not-found', title_en: 'Gallery Not Found', title_de: 'Galerie nicht gefunden' },
      { slug: 'custom', title_en: 'Custom page', title_de: 'German custom page' },
      { slug: 'not-found', title_en: 'Page Not Found' },
    ]);
  });

  afterEach(async () => db.destroy());

  it('adds Chinese defaults without altering legacy German or custom page data', async () => {
    await migration.up(db);

    const pages = await db('cms_pages').select('*').orderBy('slug');
    expect(await db.schema.hasColumn('cms_pages', 'title_zh')).toBe(true);
    expect(await db.schema.hasColumn('cms_pages', 'content_zh')).toBe(true);
    expect(pages.find((page) => page.slug === 'gallery-not-found')).toMatchObject({
      title_de: 'Galerie nicht gefunden',
      title_zh: '选片项目不存在',
    });
    expect(pages.find((page) => page.slug === 'custom')).toMatchObject({
      title_de: 'German custom page',
      title_zh: null,
      content_zh: null,
    });
    expect(pages.find((page) => page.slug === 'not-found')).toMatchObject({
      title_zh: '页面不存在',
      content_zh: '<h2>页面不存在</h2><p>你访问的页面不存在或已移动。</p>',
    });
  });

  it('preserves a Chinese content field from a partially applied prior migration', async () => {
    await db.schema.alterTable('cms_pages', (table) => {
      table.text('title_zh');
      table.text('content_zh');
    });
    await db('cms_pages').where({ slug: 'not-found' }).update({ content_zh: '<p>Admin edit</p>' });

    await migration.up(db);

    const page = await db('cms_pages').where({ slug: 'not-found' }).first();
    expect(page.title_zh).toBeNull();
    expect(page.content_zh).toBe('<p>Admin edit</p>');
  });

  it('does not fail when the CMS table is absent', async () => {
    await db.schema.dropTable('cms_pages');
    await expect(migration.up(db)).resolves.toBeUndefined();
  });
});
