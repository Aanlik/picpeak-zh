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


describe('persistent safety backup retention', () => {
  let cleanup; let RestoreService; let backupRoot; let oldBackupDir;
  beforeAll(async () => {
    ({ cleanup } = await bootTestDb());
    ({ RestoreService } = require('../../src/services/restoreService'));
    backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-safety-retention-'));
    oldBackupDir = process.env.BACKUP_DIR;
    process.env.BACKUP_DIR = backupRoot;
  }, 120000);
  afterAll(async () => {
    if (oldBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = oldBackupDir;
    if (cleanup) await cleanup();
    fs.rmSync(backupRoot, { recursive: true, force: true });
  });
  it.each([true, false])('preserves the real safety backup when rollback fails=%s', async (rollbackFails) => {
    const { spawnAsync } = require('../../src/utils/safeExec');
    spawnAsync.mockImplementation(async (program, args) => {
      const destination = args?.find(arg => typeof arg === 'string' && arg.startsWith('.backup '));
      if (program === 'sqlite3' && destination) fs.writeFileSync(destination.match(/'([^']+)'/)[1], 'original-db-bytes');
      return { stdout: '', stderr: '' };
    });
    const svc = new RestoreService();
    svc.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-cleanup-'));
    svc.loadAndValidateManifest = async () => ({ backup: { id: 'safety', type: 'full' }, files: { manifest: [] }, database: { type: 'sqlite' }, metadata: {} });
    svc.performPreRestoreValidation = async () => ({ isValid: true, warnings: [] });
    svc.checkDiskSpace = async () => ({ hasEnoughSpace: true });
    svc.performDatabaseRestore = async () => { throw new Error('restore injected failure'); };
    svc.attemptRollback = rollbackFails ? jest.fn().mockRejectedValue(new Error('rollback injected failure')) : jest.fn().mockResolvedValue();
    await expect(svc.restore({ source: '/backups', manifestPath: '/backups/m.json', restoreType: 'database' })).rejects.toThrow('restore injected failure');
    expect(fs.existsSync(svc.tempDir)).toBe(false);
    expect(svc.preRestoreBackupPath.startsWith(path.join(backupRoot, 'restore-safety'))).toBe(true);
    const snapshot = path.join(svc.preRestoreBackupPath, 'database.sql.gz');
    expect(zlib.gunzipSync(fs.readFileSync(snapshot)).toString()).toBe('original-db-bytes');
    const { db } = require('../../src/database/db');
    expect((await db('restore_runs').orderBy('id', 'desc').first()).pre_restore_backup_path).toBe(svc.preRestoreBackupPath);
    spawnAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });
  it('retains a successful restore safety backup and returns a usable path', async () => {
    const { spawnAsync } = require('../../src/utils/safeExec');
    spawnAsync.mockImplementation(async (program, args) => {
      const destination = args?.find(arg => typeof arg === 'string' && arg.startsWith('.backup '));
      if (program === 'sqlite3' && destination) fs.writeFileSync(destination.match(/'([^']+)'/)[1], 'original-db-bytes');
      return { stdout: '', stderr: '' };
    });
    const svc = new RestoreService();
    svc.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-success-cleanup-'));
    svc.loadAndValidateManifest = async () => ({ backup: { id: 'safety', type: 'full' }, files: { manifest: [] }, database: { type: 'sqlite' }, metadata: {} });
    svc.performPreRestoreValidation = async () => ({ isValid: true, warnings: [] });
    svc.checkDiskSpace = async () => ({ hasEnoughSpace: true });
    svc.performDatabaseRestore = async () => ({ success: true });
    svc.performPostRestoreVerification = async () => ({ isValid: true });
    const result = await svc.restore({ source: '/backups', manifestPath: '/backups/m.json', restoreType: 'database' });
    expect(fs.existsSync(path.join(result.preRestoreBackup, 'database.sql.gz'))).toBe(true);
    expect(fs.existsSync(svc.tempDir)).toBe(false);
    spawnAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });
  it('rejects a backup root within the cleanup directory', async () => {
    const svc = new RestoreService();
    const saved = process.env.BACKUP_DIR;
    process.env.BACKUP_DIR = svc.tempDir;
    try { await expect(svc.createPreRestoreBackup({ restoreType: 'database' })).rejects.toThrow('安全备份目录'); }
    finally { process.env.BACKUP_DIR = saved; }
  });
});
