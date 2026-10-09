'use strict';

/**
 * Resolve storage-root-relative file paths for gallery assets and uploads.
 * Paths written by an older install may be absolute; restore and read helpers
 * map those paths into the current storage root while refusing traversal.
 */

const fs = require('fs');
const path = require('path');
const { getStoragePath } = require('../config/storage');

/** Top-level storage folders the stored paths live under. */
const STORAGE_FOLDERS = ['events', 'uploads'];

/** Current project rows only store the gallery hero-logo path. */
const STORED_PATH_COLUMNS = [
  { table: 'events', column: 'hero_logo_path' },
];

const storageRoot = () => path.resolve(getStoragePath());
const legacyRoot = () => path.resolve(process.cwd(), 'storage');

function isInside(file, root) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return file.startsWith(prefix);
}

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * The storage-relative paths an absolute path could stand for: the suffix
 * from each top-level storage folder segment, last segment first. The
 * storage root is the prefix, so a folder name further in is more likely to
 * be the real one than one in the directories above the root.
 */
function storageSuffixes(absPath) {
  const segments = path.resolve(absPath).split(path.sep);
  const suffixes = [];
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (STORAGE_FOLDERS.includes(segments[i])) suffixes.push(segments.slice(i).join('/'));
  }
  return suffixes;
}

/**
 * The value to record for a file this install just wrote: relative to the
 * storage root when the file is inside it, unchanged otherwise. A relative
 * writer path is relative to the working directory (a relative STORAGE_PATH
 * such as `./storage` makes `path.join(getStoragePath(), ...)` one).
 */
function toStoredPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath;
  const abs = path.resolve(filePath);
  const root = storageRoot();
  return isInside(abs, root) ? toPosix(path.relative(root, abs)) : filePath;
}

const isStorageRelative = (value) => !path.isAbsolute(value)
  && STORAGE_FOLDERS.includes(value.split(/[\\/]/)[0]);

/**
 * A stored value rewritten for this install: relative to the storage root
 * when it is under it (and the archive carries it), else its
 * storage-relative suffix when it has one (a path recorded by another
 * install, absolute or relative to that install's working directory). `exists(relative)` picks between suffixes;
 * when it is given and the archive carries none of them, the value is kept
 * as it was, so the read-side fallbacks (resolveStoredPath) still apply to
 * it. Anything else comes back unchanged.
 */
function relocateStoredPath(value, exists = null) {
  if (!value || typeof value !== 'string' || isStorageRelative(value)) return value;
  if (path.isAbsolute(value)) {
    const own = toStoredPath(value);
    // Under this root, unless the archive says otherwise: a source root
    // inside this one (`/data/storage` restored into `/data`) lands its files
    // at the storage suffix, not at the path relative to this root.
    if (own !== value && (!exists || exists(own))) return own;
    // A file still in this install's legacy root is the one the row names;
    // the archive (the configured root only) may carry a different file
    // under the same suffix. resolveStoredPath reads it from there too.
    if (own === value && isInside(path.resolve(value), legacyRoot()) && fs.existsSync(value)) return value;
  }
  const suffixes = storageSuffixes(value);
  if (!suffixes.length) return value;
  if (!exists) return suffixes[0];
  return suffixes.find((s) => exists(s)) || value;
}

/**
 * The absolute path of a stored file on this install, or null when the value
 * cannot be placed inside the storage root. Does not require the file to
 * exist (the caller reports a missing file); it only uses existence to choose
 * between candidates.
 */
function resolveStoredPath(value) {
  if (!value || typeof value !== 'string') return null;
  const root = storageRoot();
  if (!path.isAbsolute(value)) {
    const abs = path.resolve(root, value);
    const inside = isInside(abs, root);
    if (inside && fs.existsSync(abs)) return abs;
    // Recorded relative to the working directory: a relative STORAGE_PATH
    // (`./storage`) made the writers produce `storage/uploads/...`.
    const fromCwd = path.resolve(value);
    if ((isInside(fromCwd, root) || isInside(fromCwd, legacyRoot())) && fs.existsSync(fromCwd)) return fromCwd;
    return inside ? abs : null;
  }
  const abs = path.resolve(value);
  if (isInside(abs, root)) return abs;
  const candidates = storageSuffixes(abs)
    .map((s) => path.resolve(root, s))
    .filter((c) => isInside(c, root));
  // The file the row names, when it is still there in the legacy root, wins
  // over a same-named file under the current root: writers reuse
  // document-number filenames, so the two can hold different bytes.
  if (isInside(abs, legacyRoot()) && fs.existsSync(abs)) return abs;
  const existing = candidates.find((c) => fs.existsSync(c));
  if (existing) return existing;
  return candidates[0] || null;
}

module.exports = {
  STORAGE_FOLDERS,
  STORED_PATH_COLUMNS,
  isStorageRelative,
  storageSuffixes,
  toStoredPath,
  relocateStoredPath,
  resolveStoredPath,
};
