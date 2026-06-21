#!/usr/bin/env node
// One-command release for ai-notify: bump the version, verify, publish to npm,
// tag + cut a GitHub release, and bump the Homebrew tap formula — so `npm` and
// `brew install unoryota/tap/ai-notify` never drift apart.
//
//   node scripts/release.mjs <version>     e.g. 0.4.1
//
// Assumes (all already true on the maintainer's machine):
//   - run from the ai-notify repo root, on a clean-enough `main`
//   - npm auth in ~/.npmrc is a granular token with "bypass 2FA" + publish
//   - gh is authenticated (for the GitHub release + tap push)
//   - any feature changes are ALREADY committed; this script only adds the
//     `chore(release)` version-bump commit on top.
//
// Ordering is failure-safe: the version commit + tag stay LOCAL until npm
// publish succeeds, so a failed publish can be undone (git reset/tag -d) with
// nothing pushed yet.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const TAP_REPO = 'unoryota/homebrew-tap';
const FORMULA = 'Formula/ai-notify.rb';
const SIGNOFF = 'Signed-off-by: uno <ryota.uno@o-n.co.jp>';
const COAUTHOR = 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/release.mjs <version>   e.g. 0.4.1');
  process.exit(1);
}
const tag = `v${version}`;

// Run a command, streaming its output; throws (aborting the release) on failure.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const step = (msg) => console.log(`\n▶ ${msg}`);

// 0. preflight ---------------------------------------------------------------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.name !== 'ai-notify') {
  console.error('not the ai-notify package — run from the repo root');
  process.exit(1);
}
const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  console.error(`refusing to release from '${branch}' (expected main)`);
  process.exit(1);
}
if (out('git', ['tag', '-l', tag])) {
  console.error(`tag ${tag} already exists`);
  process.exit(1);
}

// 1. bump version ------------------------------------------------------------
step(`version ${pkg.version} -> ${version}`);
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// 2. verify (same gates as CI, plus the privacy scrub) -----------------------
step('scrub + tests');
run('node', ['scripts/scrub.mjs']);
run('node', ['--test']);

// 3. commit + tag (LOCAL only — not pushed until npm publish succeeds) --------
step(`commit + tag ${tag}`);
run('git', ['add', '-A']);
run('git', ['commit', '-m', `chore(release): ${version}`, '-m', `${COAUTHOR}\n${SIGNOFF}`]);
run('git', ['tag', '-a', tag, '-m', tag]);

// 4. npm publish (prepack builds & bundles the menu bar .app) -----------------
step('npm publish');
try {
  run('npm', ['publish']);
} catch (e) {
  console.error('\nnpm publish failed — local commit/tag are NOT pushed. To undo:');
  console.error(`  git tag -d ${tag} && git reset --hard HEAD~1`);
  throw e;
}

// 5. push the release commit + tag -------------------------------------------
step('push main + tag');
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

// 6. GitHub release (auto-generated notes from commits) ----------------------
step('GitHub release');
run('gh', ['release', 'create', tag, '--title', `${tag}`, '--generate-notes', '--verify-tag']);

// 7. Homebrew tap formula bump -----------------------------------------------
step('Homebrew tap formula');
const tgzUrl = `https://registry.npmjs.org/ai-notify/-/ai-notify-${version}.tgz`;
const tgz = execFileSync('curl', ['-fsSL', tgzUrl], { maxBuffer: 1 << 30 }); // Buffer
const sha = createHash('sha256').update(tgz).digest('hex');
console.log(`  tarball sha256 ${sha}`);

const tap = mkdtempSync(join(tmpdir(), 'ai-notify-tap-'));
run('gh', ['repo', 'clone', TAP_REPO, tap, '--', '--depth', '1']);
const fpath = join(tap, FORMULA);
let formula = readFileSync(fpath, 'utf8');
const before = formula;
formula = formula.replace(/url ".*"/, `url "${tgzUrl}"`).replace(/sha256 ".*"/, `sha256 "${sha}"`);
if (formula === before || !formula.includes(sha)) {
  console.error('  could not patch the formula (url/sha256 lines not found) — bump it manually:');
  console.error(`    url "${tgzUrl}"\n    sha256 "${sha}"`);
  process.exit(1);
}
writeFileSync(fpath, formula);
run('git', ['-C', tap, 'add', FORMULA]);
run('git', ['-C', tap, 'commit', '-m', `ai-notify ${version}`, '-m', SIGNOFF]);
run('git', ['-C', tap, 'push']);

console.log(`\n✅ released ${version}: npm + GitHub + Homebrew tap are in sync`);
