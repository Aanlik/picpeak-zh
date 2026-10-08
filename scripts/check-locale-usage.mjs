import fs from 'node:fs';
import path from 'node:path';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const root = new URL('../frontend/src/', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/locales/en.json', root), 'utf8'));
const missing = [];
let files = 0, calls = 0;
function exists(key) { return [key, key + '_other'].some(k => k.split('.').reduce((v, part) => v?.[part], en) !== undefined); }
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { visit(file); continue; }
    if (!/\.tsx?$/.test(file) || /(__tests__|\.test\.)/.test(file)) continue;
    files++;
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function walk(node) {
      if (ts.isCallExpression(node) && /^(t|tAudit|i18n\.t)$/.test(node.expression.getText(ast))) {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key)) {
          calls++;
          if (!exists(key.text)) missing.push(`${file}:${ast.getLineAndCharacterOfPosition(key.getStart(ast)).line + 1} ${key.text}`);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
}
visit(root.pathname);
if (missing.length) { console.error(missing.join('\n')); process.exit(1); }
console.log(`翻译引用检查通过：${files} 个文件，${calls} 个静态引用`);
