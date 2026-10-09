/** Storage-path containment helpers for uploads and archived files. */

const fs = require('fs');
const path = require('path');
const { AppError } = require('./errors');
const { getStoragePath } = require('../config/storage');
const { resolveStoredPath } = require('./storedPath');

/**
 * Resolve the canonical (symlink-followed) absolute path. Throws
 * AppError 404 when the file is missing on disk; caller handles
 * the 404 response.
 */
function realpathOr404(absPath) {
  try {
    return fs.realpathSync(absPath);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      throw new AppError('File missing on disk', 404, 'FILE_MISSING');
    }
    throw err;
  }
}

/**
 * Assert that `filePath` resolves to a location inside one of
 * `allowedRoots`. Throws AppError 403 on violation.
 *
 * Both inputs are resolved through realpath so symlinks in either
 * direction are followed before comparison. `allowedRoots` that
 * don't themselves exist are silently dropped from the check (a
 * a newly configured storage root may be missing on first boot, for example) — at least one
 * root MUST exist for the check to allow the path.
 */
function assertPathInside(filePath, allowedRoots) {
  if (!filePath) throw new AppError('No path provided', 400);
  const resolvedFile = realpathOr404(filePath);
  const resolvedRoots = [];
  for (const root of allowedRoots) {
    if (!root) continue;
    try {
      const r = fs.realpathSync(root);
      // Append a separator so /storage/foo doesn't match /storage/foo-evil.
      resolvedRoots.push(r.endsWith(path.sep) ? r : r + path.sep);
    } catch (_) {
      // Root doesn't exist yet — fall through. Next iteration may resolve.
    }
  }
  if (resolvedRoots.length === 0) {
    // Defensive: refuse rather than allowing free access when no root
    // exists. Should only happen on a half-provisioned install.
    throw new AppError('No allowed storage roots configured', 500, 'NO_STORAGE_ROOTS');
  }
  const ok = resolvedRoots.some((root) =>
    resolvedFile === root.slice(0, -1) || resolvedFile.startsWith(root)
  );
  if (!ok) {
    throw new AppError('Refusing to serve a file outside the storage roots', 403, 'PATH_OUTSIDE_STORAGE');
  }
  return resolvedFile;
}

/**
 * assertPathInside for a path read from the database. The stored value may be
 * storage-relative or an absolute path recorded by another install; it is
 * placed on this install's storage root first (storedPath.js), and a value
 * that cannot be placed inside it is refused like any other outside path.
 */
function assertStoredPathInside(storedPath, allowedRoots) {
  if (!storedPath) throw new AppError('No path provided', 400);
  const resolved = resolveStoredPath(storedPath);
  if (!resolved) {
    throw new AppError('Refusing to serve a file outside the storage roots', 403, 'PATH_OUTSIDE_STORAGE');
  }
  return assertPathInside(resolved, allowedRoots);
}

/**
 * The directories a stored path may name at all: the storage root, and
 * <cwd>/storage, the legacy root used by earlier versions.
 */
function storageRoots() {
  return [getStoragePath(), path.join(process.cwd(), 'storage')];
}

/**
 * The file a stored path names, for a reader that opens it: placed on this
 * install's storage root, then checked with symlinks followed. Returns null
 * when there is no value or the file is simply not there, so the caller keeps
 * its own "missing" handling. A value that cannot be placed inside
 * `allowedRoots` (tampering, a crafted restore) throws AppError 403.
 */
function resolveStoredPathStrict(storedPath, allowedRoots = storageRoots()) {
  if (!storedPath) return null;
  try {
    return assertStoredPathInside(storedPath, allowedRoots);
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * ZIP-slip guard. `node-stream-zip`'s `extract(null, root)` writes each entry
 * to `path.join(root, entry.name)` without neutralising `../` — a crafted
 * archive with an entry named `../../uploads/logos/evil.svg` escapes `root`
 * and overwrites arbitrary files (GHSA-jfhw-fj23-fx6x). Call this with the
 * entry list BEFORE extract() to reject any entry that resolves outside the
 * target directory.
 *
 * Purely lexical (path.resolve, no realpath) because the extraction target
 * does not exist on disk yet. Absolute entry names (`/etc/passwd`) resolve
 * away from `root` and are caught too. Throws AppError 400 on the first
 * offending entry so the whole archive is refused.
 *
 * @param {Array<{name?: string}>} entries  node-stream-zip entry objects
 * @param {string} extractRoot              directory extract() will write into
 */
function assertZipEntriesWithin(entries, extractRoot) {
  const rootResolved = path.resolve(extractRoot);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  for (const entry of entries || []) {
    const name = entry && entry.name;
    if (!name) continue;
    const target = path.resolve(rootResolved, name);
    if (target !== rootResolved && !target.startsWith(prefix)) {
      throw new AppError(
        `Archive contains an entry that escapes the extraction directory: ${name}`,
        400,
        'ZIP_SLIP'
      );
    }
  }
}

/**
 * Resolve a stored `/uploads/<kind>/<file>` URL to the file it names inside
 * that upload directory, or null when the value is not one of ours.
 *
 * Only the basename is trusted: the URL comes from an admin-writable
 * setting, and `path.join(storage, url)` after a `startsWith('/uploads/…')`
 * check still collapses `..` segments, so it could name any file the process
 * can delete. Restricting to a flat leaf inside the fixed directory is the
 * whole control -- the upload routes only ever write flat filenames there.
 *
 * @param {string} url          stored value, e.g. "/uploads/logos/logo-1.png"
 * @param {string} kind         "logos" | "favicons"
 * @param {string} storageRoot  the root the writer used (callers differ)
 */
function uploadedAssetPath(url, kind, storageRoot) {
  if (!url || typeof url !== 'string') return null;
  const prefix = `/uploads/${kind}/`;
  if (!url.startsWith(prefix)) return null;
  const leaf = url.slice(prefix.length);
  if (!leaf || leaf === '.' || leaf === '..' || path.basename(leaf) !== leaf) return null;
  return path.join(storageRoot, 'uploads', kind, leaf);
}

/**
 * Extensions the public /uploads/logos and /uploads/favicons trees serve.
 * Every upload route that writes there accepts only these image types, but
 * older versions kept the client's extension, so a file named .html or .js
 * can still be on disk from before. It is not served from the app origin.
 */
const PUBLIC_UPLOAD_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];

function isPublicUploadImage(filePath) {
  return PUBLIC_UPLOAD_IMAGE_EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase());
}

module.exports = {
  assertPathInside,
  assertStoredPathInside,
  resolveStoredPathStrict,
  storageRoots,
  assertZipEntriesWithin,
  uploadedAssetPath,
  isPublicUploadImage,
  PUBLIC_UPLOAD_IMAGE_EXTENSIONS,
};
