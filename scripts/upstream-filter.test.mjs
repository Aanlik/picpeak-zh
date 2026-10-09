import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyPaths, isExcludedPath, loadPatterns } from './upstream-filter.mjs';

const script = new URL('./upstream-filter.mjs', import.meta.url);
function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitAll(cwd, message) {
  runGit(cwd, ['add', '-A']);
  runGit(cwd, ['commit', '-m', message]);
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

test('retired module globs match files and future additions without swallowing shared modules', () => {
  const patterns = loadPatterns(new URL('../', import.meta.url).pathname);
  assert.equal(isExcludedPath('frontend/src/pages/admin/contracts/NewOfficialPage.tsx', patterns), true);
  assert.equal(isExcludedPath('backend/src/services/contract/signatures.js', patterns), true);
  assert.equal(isExcludedPath('backend/src/services/documentWorkflow.js', patterns), false);
  assert.equal(isExcludedPath('frontend/src/pages/admin/projects/NewCockpitPanel.tsx', patterns), true);
  assert.equal(isExcludedPath('backend/src/services/pdfService.js', patterns), true);
  assert.equal(isExcludedPath('backend/src/services/backupIntegrityService.js', patterns), true);
  assert.equal(isExcludedPath('backend/src/routes/adminDev.js', patterns), true);
  assert.equal(isExcludedPath('backend/src/services/invoice/newWorkflow.js', patterns), true);
  assert.equal(isExcludedPath('backend/__tests__/services/billingRecipients.test.js', patterns), true);
  assert.equal(isExcludedPath('backend/__tests__/whatsappLegacy.test.js', patterns), true);
  assert.equal(isExcludedPath('frontend/src/pages/admin/EventDetailsPage.tsx', patterns), false);
  assert.equal(isExcludedPath('backend/src/services/changeHistory.js', patterns), false);
  assert.equal(isExcludedPath('backend/src/services/backupService.js', patterns), false);
  assert.equal(isExcludedPath('backend/__tests__/services/logActivityShared.test.js', patterns), false);
  assert.equal(isExcludedPath('frontend/src/pages/admin/galleries/GalleryListPage.tsx', patterns), false);
  const result = classifyPaths([
    'frontend/src/pages/admin/contracts/NewOfficialPage.tsx',
    'frontend/src/pages/admin/EventDetailsPage.tsx',
  ], patterns);
  assert.deepEqual(result.excluded, ['frontend/src/pages/admin/contracts/NewOfficialPage.tsx']);
  assert.deepEqual(result.included, ['frontend/src/pages/admin/EventDetailsPage.tsx']);
});

test('filtered upstream tree drops retired modules and preserves shared upstream changes', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'picpeak-upstream-merge-test-'));
  try {
    mkdirSync(join(fixture, '.fork'), { recursive: true });
    writeFileSync(join(fixture, '.fork/upstream-exclusions.txt'), readFileSync(new URL('../.fork/upstream-exclusions.txt', import.meta.url)));
    runGit(fixture, ['init', '-b', 'upstream-base']);
    runGit(fixture, ['config', 'user.name', 'Test']);
    runGit(fixture, ['config', 'user.email', 'test@example.invalid']);
    mkdirSync(join(fixture, 'backend/src/routes'), { recursive: true });
    mkdirSync(join(fixture, 'backend/src/services/contract'), { recursive: true });
    mkdirSync(join(fixture, 'frontend/src/pages/admin/contracts'), { recursive: true });
    writeFileSync(join(fixture, 'backend/src/routes/adminInvoices.js'), 'module.exports = "old";\n');
    writeFileSync(join(fixture, 'backend/src/services/contract/legacyDocument.js'), "'use strict';\nmodule.exports = {\n  render: true,\n  verify: true,\n  legacy: true,\n};\n");
    writeFileSync(join(fixture, 'frontend/src/pages/admin/contracts/old.tsx'), 'export default "old";\n');
    writeFileSync(join(fixture, 'shared.js'), 'header\nfork setting: base\nspacer one\nspacer two\nofficial setting: base\nfooter\n');
    writeFileSync(join(fixture, 'events.js'), 'unchanged\n');
    const base = commitAll(fixture, 'base');

    runGit(fixture, ['switch', '-c', 'fork']);
    rmSync(join(fixture, 'backend/src/routes/adminInvoices.js'));
    rmSync(join(fixture, 'backend/src/services/contract'), { recursive: true, force: true });
    rmSync(join(fixture, 'frontend/src/pages/admin/contracts'), { recursive: true, force: true });
    writeFileSync(join(fixture, 'shared.js'), 'header\nfork setting: changed\nspacer one\nspacer two\nofficial setting: base\nfooter\n');
    commitAll(fixture, 'fork removals');

    runGit(fixture, ['switch', 'upstream-base']);
    writeFileSync(join(fixture, 'backend/src/routes/adminInvoices.js'), 'module.exports = "changed upstream";\n');
    rmSync(join(fixture, 'backend/src/services/contract/legacyDocument.js'));
    writeFileSync(join(fixture, 'backend/src/services/documentWorkflow.js'), "'use strict';\nmodule.exports = {\n  render: true,\n  verify: true,\n  legacy: false,\n};\n");
    writeFileSync(join(fixture, 'frontend/src/pages/admin/contracts/new.tsx'), 'export default "new";\n');
    writeFileSync(join(fixture, 'shared.js'), 'header\nfork setting: base\nspacer one\nspacer two\nofficial setting: improved\nfooter\n');
    writeFileSync(join(fixture, 'events.js'), 'official event improvement\n');
    const incoming = commitAll(fixture, 'official stable update');

    const output = execFileSync(process.execPath, [new URL('./upstream-filter.mjs', import.meta.url).pathname, '--filter', incoming, base], {
      cwd: fixture,
      encoding: 'utf8',
    });
    const { filteredCommit, excluded } = JSON.parse(output);
    assert.ok(excluded.includes('backend/src/routes/adminInvoices.js'));
    assert.ok(excluded.includes('backend/src/services/documentWorkflow.js'));
    assert.ok(excluded.includes('frontend/src/pages/admin/contracts/new.tsx'));

    const allOutput = execFileSync(process.execPath, [new URL('./upstream-filter.mjs', import.meta.url).pathname, '--filter', incoming, base, '--all'], {
      cwd: fixture,
      encoding: 'utf8',
    });
    const allResult = JSON.parse(allOutput);
    assert.deepEqual(allResult.excluded, []);
    assert.equal(allResult.filteredCommit, incoming);
    const allPlan = JSON.parse(execFileSync(process.execPath, [new URL('./upstream-filter.mjs', import.meta.url).pathname, '--classify', base, incoming, '--all'], {
      cwd: fixture,
      encoding: 'utf8',
    }));
    assert.deepEqual(allPlan.excluded, []);
    assert.ok(allPlan.included.includes('backend/src/routes/adminInvoices.js'));

    runGit(fixture, ['switch', 'fork']);
    runGit(fixture, ['merge', '--no-ff', '--no-commit', filteredCommit]);
    assert.equal(readFileSync(join(fixture, 'shared.js'), 'utf8'), 'header\nfork setting: changed\nspacer one\nspacer two\nofficial setting: improved\nfooter\n');
    assert.equal(readFileSync(join(fixture, 'events.js'), 'utf8'), 'official event improvement\n');
    assert.equal(runGit(fixture, ['ls-files', 'backend/src/routes/adminInvoices.js']), '');
    assert.equal(runGit(fixture, ['ls-files', 'backend/src/services/documentWorkflow.js']), '');
    assert.equal(runGit(fixture, ['ls-files', 'frontend/src/pages/admin/contracts/new.tsx']), '');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('sync script aborts on shared-file conflicts and restores the pre-merge tree', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'picpeak-upstream-abort-test-'));
  const upstream = join(fixture, 'upstream');
  const fork = join(fixture, 'fork');
  try {
    mkdirSync(upstream, { recursive: true });
    runGit(upstream, ['init', '-b', 'stable']);
    runGit(upstream, ['config', 'user.name', 'Test']);
    runGit(upstream, ['config', 'user.email', 'test@example.invalid']);
    mkdirSync(join(upstream, '.fork'), { recursive: true });
    mkdirSync(join(upstream, 'scripts'), { recursive: true });
    mkdirSync(join(upstream, 'backend/src/routes'), { recursive: true });
    writeFileSync(join(upstream, '.fork/upstream-exclusions.txt'), readFileSync(new URL('../.fork/upstream-exclusions.txt', import.meta.url)));
    writeFileSync(join(upstream, 'scripts/upstream-filter.mjs'), readFileSync(new URL('./upstream-filter.mjs', import.meta.url)));
    writeFileSync(join(upstream, 'scripts/sync-upstream-zh.sh'), readFileSync(new URL('./sync-upstream-zh.sh', import.meta.url)));
    writeFileSync(join(upstream, 'backend/src/routes/adminInvoices.js'), 'module.exports = "base";\n');
    writeFileSync(join(upstream, 'shared.js'), 'setting=base\n');
    const baseline = commitAll(upstream, 'baseline');

    execFileSync('git', ['clone', upstream, fork], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    runGit(fork, ['config', 'user.name', 'Test']);
    runGit(fork, ['config', 'user.email', 'test@example.invalid']);
    runGit(fork, ['switch', '-c', 'fork']);
    writeFileSync(join(fork, '.picpeak-upstream-sha'), `${baseline}\n`);
    rmSync(join(fork, 'backend/src/routes/adminInvoices.js'));
    writeFileSync(join(fork, 'shared.js'), 'setting=fork\n');
    commitAll(fork, 'fork module removal and shared edit');

    writeFileSync(join(upstream, 'backend/src/routes/adminInvoices.js'), 'module.exports = "official update";\n');
    writeFileSync(join(upstream, 'shared.js'), 'setting=official\n');
    commitAll(upstream, 'official stable update');

    const allPlan = spawnSync('bash', ['scripts/sync-upstream-zh.sh', '--plan', '--all'], {
      cwd: fork,
      encoding: 'utf8',
      env: { ...process.env, PICPEAK_UPSTREAM_REMOTE: 'origin', PICPEAK_UPSTREAM_BRANCH: 'stable' },
    });
    assert.equal(allPlan.status, 0, `${allPlan.stdout}\n${allPlan.stderr}`);
    assert.match(allPlan.stdout, /完整同步官方代码/);
    assert.match(allPlan.stdout, /backend\/src\/routes\/adminInvoices\.js/);

    const excludePlan = spawnSync('bash', ['scripts/sync-upstream-zh.sh', '--plan', '--exclude-retired'], {
      cwd: fork,
      encoding: 'utf8',
      env: { ...process.env, PICPEAK_UPSTREAM_REMOTE: 'origin', PICPEAK_UPSTREAM_BRANCH: 'stable' },
    });
    assert.equal(excludePlan.status, 0, `${excludePlan.stdout}\n${excludePlan.stderr}`);
    assert.match(excludePlan.stdout, /剔除本 Fork 已删除的模块/);
    assert.match(excludePlan.stdout, /自动过滤的已移除模块：[\s\S]*adminInvoices\.js/);

    const result = spawnSync('bash', ['scripts/sync-upstream-zh.sh', '--merge', '--exclude-retired'], {
      cwd: fork,
      encoding: 'utf8',
      env: { ...process.env, PICPEAK_UPSTREAM_REMOTE: 'origin', PICPEAK_UPSTREAM_BRANCH: 'stable' },
    });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /共享文件冲突，已自动中止合并/);
    assert.equal(readFileSync(join(fork, 'shared.js'), 'utf8'), 'setting=fork\n');
    assert.equal(readFileSync(join(fork, '.picpeak-upstream-sha'), 'utf8'), `${baseline}\n`);
    assert.equal(runGit(fork, ['status', '--porcelain']), '');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
