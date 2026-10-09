#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POLICY_PATH = '.fork/upstream-exclusions.txt';

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

export function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === '*' && next === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export function loadPatterns(repoRoot = process.cwd()) {
  return readFileSync(join(repoRoot, POLICY_PATH), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function isExcludedPath(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

export function classifyPaths(paths, patterns) {
  const included = [];
  const excluded = [];
  for (const filePath of paths) {
    (isExcludedPath(filePath, patterns) ? excluded : included).push(filePath);
  }
  return { included, excluded };
}

function changedFiles(base, incoming) {
  const tokens = git(['diff', '--name-status', '--find-renames', '-z', base, incoming], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (status.startsWith('R') || status.startsWith('C')) {
      changes.push({ status, previousPath: tokens[index++], path: tokens[index++] });
    } else {
      changes.push({ status, previousPath: null, path: tokens[index++] });
    }
  }
  return changes;
}

function classifyChanges(changes, patterns) {
  const included = [];
  const excluded = [];
  for (const change of changes) {
    const retired = isExcludedPath(change.path, patterns)
      || (change.previousPath && isExcludedPath(change.previousPath, patterns));
    (retired ? excluded : included).push(change.path);
  }
  return { included, excluded };
}

function treePaths(revision) {
  return git(['ls-tree', '-r', '-z', '--name-only', revision], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function filterTree(revision, excludedPaths) {
  const tempIndexDirectory = mkdtempSync(join(tmpdir(), 'picpeak-upstream-index-'));
  const indexPath = join(tempIndexDirectory, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: indexPath };
    git(['read-tree', revision], { env });
    if (excludedPaths.length) {
      git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...excludedPaths], { env });
    }
    const tree = git(['write-tree'], { env }).trim();
    const filteredCommit = git([
      '-c', 'user.name=PicPeak upstream policy',
      '-c', 'user.email=upstream-policy@localhost',
      'commit-tree', tree, '-p', revision,
      '-m', `chore: filter retired modules from upstream ${revision}`,
    ]).trim();
    return filteredCommit;
  } finally {
    rmSync(tempIndexDirectory, { recursive: true, force: true });
  }
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  const patterns = loadPatterns();
  if (mode === '--filter' && args.length >= 1 && args.length <= 3) {
    const [revision, ...options] = args;
    const includeRetired = options.includes('--all');
    const baseline = options.find((option) => option !== '--all');
    const excludedPaths = new Set(classifyPaths(treePaths(revision), patterns).excluded);
    if (!includeRetired && baseline) {
      for (const change of changedFiles(baseline, revision)) {
        if (change.previousPath && isExcludedPath(change.previousPath, patterns)) {
          excludedPaths.add(change.path);
        }
      }
    }
    const excluded = includeRetired ? [] : [...excludedPaths];
    const filteredCommit = excluded.length ? filterTree(revision, excluded) : revision;
    process.stdout.write(`${JSON.stringify({ revision, filteredCommit, excluded }, null, 2)}\n`);
    return;
  }
  if (mode === '--classify' && (args.length === 2 || args.length === 3)) {
    const [base, incoming, ...options] = args;
    const includeRetired = options.includes('--all');
    const changes = changedFiles(base, incoming);
    const classified = classifyChanges(changes, includeRetired ? [] : patterns);
    const forkChanges = new Set(git(['diff', '--name-only', '-z', base], { encoding: 'buffer' })
      .toString('utf8')
      .split('\0')
      .filter(Boolean));
    const overlapping = classified.included.filter((filePath) => forkChanges.has(filePath));
    process.stdout.write(`${JSON.stringify({ base, incoming, ...classified, overlapping }, null, 2)}\n`);
    return;
  }
  if (mode === '--is-excluded' && args.length === 1) {
    process.exitCode = isExcludedPath(args[0], patterns) ? 0 : 1;
    return;
  }
  process.stderr.write('Usage: upstream-filter.mjs --filter <upstream-sha> [baseline-sha] [--all] | --classify <base-sha> <upstream-sha> [--all] | --is-excluded <path>\n');
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
