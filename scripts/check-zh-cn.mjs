#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enPath = process.argv[2] || path.join(root, 'frontend/src/i18n/locales/en.json');
const zhPath = process.argv[3] || path.join(root, 'frontend/src/i18n/locales/zh-CN.json');
function flatten(value, prefix = '') {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.entries(flatten(item, name)) : [[name, item]];
  }));
}
const en = flatten(JSON.parse(fs.readFileSync(enPath, 'utf8')));
const zh = flatten(JSON.parse(fs.readFileSync(zhPath, 'utf8')));
const failures = [];
const variables = text => [...text.matchAll(/\{\{\s*(-?\s*[\w.]+)(?:\s*,[^}]+)?\s*\}\}/g)].map(x => x[1].replace(/\s/g, '')).sort().join('|');
const literals = text => [...text.matchAll(/(?<!\{)\{[A-Z_][A-Z_0-9:]*(?:\.[A-Z_0-9]+)?\}(?!\})/g)].map(x => x[0]).sort().join('|');
for (const [key, value] of Object.entries(en)) {
  if (!(key in zh)) { failures.push(`缺少键: ${key}`); continue; }
  if (typeof value !== typeof zh[key] || typeof zh[key] !== 'string' || !zh[key].trim()) {
    failures.push(`类型或空译文: ${key}`); continue;
  }
  if (variables(value) !== variables(zh[key])) failures.push(`插值变量不一致: ${key}`);
  if (literals(value) !== literals(zh[key])) failures.push(`模板占位符不一致: ${key}`);
  if (/<unk>|ưμ|㼯/.test(zh[key])) failures.push(`无效翻译字符: ${key}`);
}
for (const key of Object.keys(zh)) if (!(key in en)) failures.push(`多余键: ${key}`);
// Exact parity includes every plural form. Chinese uses _other at runtime,
// but upstream _one/_zero/etc remain present for low-conflict updates.
const pluralKeys = Object.keys(en).filter(k => /_(zero|one|two|few|many|other)$/.test(k));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`zh-CN 检查通过: ${Object.keys(en).length} 个键，${pluralKeys.length} 个复数键，插值/模板占位符一致`);
