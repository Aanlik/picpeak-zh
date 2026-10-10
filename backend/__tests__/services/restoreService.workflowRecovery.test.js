jest.mock('../../src/services/workflowBackup', () => ({ checkpoint: jest.fn(), restore: jest.fn().mockResolvedValue(), release: jest.fn().mockResolvedValue(), hold: jest.fn().mockResolvedValue() }));
/**
 * Built-in full/database restores (and the rollback that replays the
 * pre-restore dump) replace the identity tables but never advanced the global
 * session cutoff, so every admin, customer and gallery JWT minted before the
 * restore kept resolving its numeric id against the restored rows. The
 * portable import did stamp a cutoff, but at "now" in whole seconds while
 * isTokenBeforeCutoff() rejects only `iat < cutoff`, so a token minted
 * earlier in the same second survived. Scanner finding 5f6017d2.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-restore-cutoff-')), 'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'restore-cutoff-test-secret';

// The restore shells out (post-restore migrations, sqlite3 .restore on
// rollback); none of that is under test here.
jest.mock('../../src/utils/safeExec', () => ({
  spawnAsync: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  spawnToFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  spawnFromFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

const { bootTestDb } = require('../integration/helpers/sqliteTestDb');

describe('restoreService — joint workflow recovery', () => {
  let cleanup; let RestoreService; let _internal; let cutoff;

  const stubbedService = (restoreType) => {
    const svc = new RestoreService();
    svc.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-restore-cutoff-tmp-'));
    svc.loadAndValidateManifest = async () => ({
      backup: { id: 'b1', type: 'full', timestamp: new Date().toISOString() },
      files: { count: 0, total_size: 0, manifest: [] },
      database: { type: 'sqlite' },
      metadata: {},
    });
    svc.performPreRestoreValidation = async () => ({ isValid: true, errors: [], warnings: [] });
    svc.checkDiskSpace = async () => ({ hasEnoughSpace: true });
    svc.performDatabaseRestore = async () => ({ success: true });
    svc.performFilesRestore = async () => ({ filesRestored: 0, totalFiles: 0, errors: [] });
    svc.performFullRestore = async () => ({ databaseRestored: true, filesRestored: 0, errors: [] });
    svc.performPostRestoreVerification = async () => ({ isValid: true, errors: [], checksums: {} });
    svc.requeueFaceScans = async () => {};
    svc.sendRestoreNotification = async () => {};
    return { svc, options: { source: '/backups', manifestPath: '/backups/m.json', restoreType, skipPreBackup: true } };
  };

  beforeAll(async () => {
    ({ cleanup } = await bootTestDb());
    ({ RestoreService, _internal } = require('../../src/services/restoreService'));
    cutoff = require('../../src/utils/sessionCutoff');
  }, 120000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  beforeEach(async () => {
    await cutoff.setSessionsValidAfter(0);
    cutoff._resetCache();
  });


  it.each([
    ['joint rollback', false, false, false],
    ['PicPeak rollback failure', true, false, false],
    ['Bridge rollback failure', false, true, false],
    ['no safety backup', false, false, true],
  ])('%s after a late restore failure', async (_label, failPicPeak, failBridge, skipBackup) => {
    const workflow = require('../../src/services/workflowBackup');
    const { db } = require('../../src/database/db');
    jest.clearAllMocks();
    workflow.checkpoint.mockResolvedValue({ token: 'audit', state: { version: 1, marker: 'before' } });
    workflow.restore.mockReset().mockResolvedValue();
    if (failBridge) workflow.restore.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Bridge rollback offline'));
    const { svc, options } = stubbedService('database');
    const originalManifest = svc.loadAndValidateManifest;
    svc.loadAndValidateManifest = async () => ({ ...await originalManifest(), metadata: { workflow_state: { version: 1, marker: 'backup' } } });
    svc.createPreRestoreBackup = jest.fn().mockResolvedValue('/audit/safety');
    svc.attemptRollback = failPicPeak ? jest.fn().mockRejectedValue(new Error('rollback offline')) : jest.fn().mockResolvedValue();
    options.skipPreBackup = skipBackup;
    if (skipBackup) svc.preRestoreBackupPath = '/stale/previous-run';
    await db.raw("CREATE TRIGGER audit_late_failure BEFORE UPDATE ON restore_runs WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'audit disk failure'); END");
    try {
      await expect(svc.restore(options)).rejects.toThrow('audit disk failure');
      expect(svc.attemptRollback).toHaveBeenCalledTimes(skipBackup ? 0 : 1);
      expect(workflow.restore.mock.calls.map(call => call[0].marker)).toEqual(failPicPeak || skipBackup ? ['backup'] : ['backup', 'before']);
      const unsafe = failPicPeak || failBridge || skipBackup;
      expect(workflow.release).toHaveBeenCalledTimes(unsafe ? 0 : 1);
      expect(workflow.hold).toHaveBeenCalledTimes(unsafe ? 1 : 0);
      if (failBridge) expect((await db('restore_runs').orderBy('id', 'desc').first()).error_message).toContain('精修状态回滚失败');
    } finally { await db.raw('DROP TRIGGER audit_late_failure'); }
  });

  it('releases the checkpoint after a complete joint restore', async () => {
    const workflow = require('../../src/services/workflowBackup');
    jest.clearAllMocks();
    workflow.checkpoint.mockResolvedValue({ token: 'audit', state: { version: 1, marker: 'before' } });
    workflow.restore.mockReset().mockResolvedValue();
    const { svc, options } = stubbedService('database');
    const originalManifest = svc.loadAndValidateManifest;
    svc.loadAndValidateManifest = async () => ({ ...await originalManifest(), metadata: { workflow_state: { version: 1, marker: 'backup' } } });
    expect((await svc.restore(options)).success).toBe(true);
    expect(workflow.restore.mock.calls.map(call => call[0].marker)).toEqual(['backup']);
    expect(workflow.release).toHaveBeenCalledTimes(1);
    expect(workflow.hold).not.toHaveBeenCalled();
  });
});
