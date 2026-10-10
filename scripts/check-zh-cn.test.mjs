import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const checker = fileURLToPath(new URL('./check-zh-cn.mjs', import.meta.url));
function check(en, zh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-parity-'));
  try {
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(en));
    fs.writeFileSync(path.join(dir, 'zh.json'), JSON.stringify(zh));
    return spawnSync(process.execPath, [checker, path.join(dir, 'en.json'), path.join(dir, 'zh.json')], { encoding: 'utf8' });
  } finally { fs.rmSync(dir, { recursive: true }); }
}
test('English keys missing from Chinese fail CI', () => assert.equal(check({ added: 'New' }, {}).status, 1));
test('lost interpolation fails CI', () => assert.equal(check({ text: '{{count}} photos' }, { text: '照片' }).status, 1));
test('lost plural form fails CI', () => assert.equal(check({ text_one: 'One', text_other: 'Many' }, { text_other: '多张' }).status, 1));
test('lost template placeholder fails CI', () => assert.equal(check({ text: '{INVOICE}' }, { text: '{INVOCE}' }).status, 1));
test('compatible translation passes', () => assert.equal(check({ text: '{{count}} photos' }, { text: '{{count}} 张照片' }).status, 0));
