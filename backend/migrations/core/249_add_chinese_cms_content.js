'use strict';

/**
 * Add Simplified Chinese content for customizable public error/legal pages.
 * Existing German columns are retained in place for safe upgrades, but the
 * current UI/API no longer reads or writes them.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('cms_pages'))) return;

  if (!(await knex.schema.hasColumn('cms_pages', 'title_zh'))) {
    await knex.schema.alterTable('cms_pages', (table) => table.text('title_zh'));
  }
  if (!(await knex.schema.hasColumn('cms_pages', 'content_zh'))) {
    await knex.schema.alterTable('cms_pages', (table) => table.text('content_zh'));
  }

  const builtInChinesePages = [
    {
      slug: 'impressum',
      title_zh: '法律声明',
      content_zh: '<h2>法律声明</h2><p>请在管理后台编辑此内容。</p>',
    },
    {
      slug: 'datenschutz',
      title_zh: '隐私政策',
      content_zh: '<h2>隐私政策</h2><p>请在管理后台编辑此内容。</p>',
    },
    {
      slug: 'not-found',
      title_zh: '页面不存在',
      content_zh: '<h2>页面不存在</h2><p>你访问的页面不存在或已移动。</p>',
    },
    {
      slug: 'gallery-not-found',
      title_zh: '选片项目不存在',
      content_zh: '<h2>选片项目不存在</h2><p>未找到此选片项目。链接可能有误，或项目已过期、归档。请联系摄影师确认。</p>',
    },
  ];

  for (const page of builtInChinesePages) {
    // Never replace an existing Chinese translation or user customization.
    // eslint-disable-next-line no-await-in-loop
    await knex('cms_pages')
      .where({ slug: page.slug })
      .whereNull('title_zh')
      .whereNull('content_zh')
      .update({ title_zh: page.title_zh, content_zh: page.content_zh });
  }
};

exports.down = async function down() {
  // Keep Chinese content on downgrade; dropping it would destroy edits.
};
